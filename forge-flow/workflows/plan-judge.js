export const meta = {
  name: 'forge-flow-plan-judge',
  description: 'forge-flow plan 생성 — 관점별 독립 계획안 fan-out(judge panel) + 채점 + 합성 가이드. 계획 초안·순위만 반환, 최종 작성·wave 분해·상태쓰기는 메인.',
  phases: [
    { title: 'Draft' },   // 관점별 독립 계획 초안
    { title: 'Judge' },   // 초안별 병렬 채점
  ],
}

// ── 입력 (메인스레드가 args로 주입) ───────────────────────────────
// args = {
//   taskId, scale: 'S'|'M'|'L',
//   acList: string,            // ## 요구사항/AC 발췌 (구현 대상)
//   patternsExcerpt: string,   // design "따를 기존 패턴" 발췌
//   explorationSummary: string,// 1단계 탐색 팀 출력: [변경 대상 파일]/[영향 범위]/[기존 패턴]/[리스크]
//   projectContext: string,    // CLAUDE.md 스택/구조 + build_commands 요약 (≤3줄)
//   reworkLogExcerpt: string,  // rework-log [계획]/[코드] ×2+ 발췌 (반복 실수 회피)
//   numDrafts: number?,        // 초안 수 오버라이드. 미설정 시 규모 기본
// }
// args는 문자열(JSON)로 도달할 수 있음 → 방어적 파싱 필수 (verify.js와 동일 계약).
let A = args || {}
if (typeof A === 'string') {
  try { A = JSON.parse(A) } catch (e) { throw new Error('plan-judge: args 파싱 실패 — ' + e.message) }
}
// fail-fast: 구현 대상(AC) 미주입 시 즉시 중단 (에이전트 FS 크롤 → 타프로젝트 환각 방지).
if (!A.acList || !String(A.acList).trim()) {
  throw new Error('plan-judge: acList 미주입 — 메인이 ## 요구사항/AC를 args.acList로 주입해야 함.')
}
const scale = A.scale || 'M'

// ── 계획 생성 관점 (해법 다양성 확보) ─────────────────────────────
// 각 초안은 서로 다른 우선순위로 동일 AC를 만족하는 계획을 독립 생성한다.
const ANGLE_POOL = [
  { key: 'MVP우선', focus: 'AC를 만족하는 최소 변경. 디프 최소화·가장 단순한 경로. 초과구현 배제.' },
  { key: '리스크우선', focus: '가장 위험한 부분(외부 의존·계약 변경·동시성·마이그레이션)을 먼저 식별하고 그것을 먼저 무력화하는 순서로 설계.' },
  { key: '패턴충실우선', focus: 'design "따를 기존 패턴"과의 일관성 극대화. 기존 추상화·네이밍·레이어 경계 최대 준수.' },
]
// 초안 수 = 해법 공간 너비. 규모 클수록 넓음. S는 SKILL이 본 워크플로를 스킵(단일 계획).
const SCALE_DRAFTS = { S: 1, M: 2, L: 3 }
const numDrafts = Math.max(1, Math.min(A.numDrafts || SCALE_DRAFTS[scale] || 2, ANGLE_POOL.length))

function anglesFor(n) {
  const out = []
  for (let i = 0; i < n; i++) out.push(ANGLE_POOL[i % ANGLE_POOL.length])
  return out
}

// ── 스키마 ────────────────────────────────────────────────────────
const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'changeFiles', 'sequence', 'risks', 'workUnits'],
  properties: {
    summary: { type: 'string', description: '이 계획안의 핵심 접근 한 줄' },
    changeFiles: {
      type: 'array', description: '변경 대상 파일과 사유',
      items: {
        type: 'object', additionalProperties: false,
        required: ['file', 'reason'],
        properties: { file: { type: 'string' }, reason: { type: 'string' } },
      },
    },
    sequence: { type: 'array', items: { type: 'string' }, description: '구현 순서 단계' },
    risks: { type: 'array', items: { type: 'string' }, description: '리스크 항목' },
    workUnits: {
      type: 'array',
      description: 'work unit 초안. writes/reads는 파일 단위. wave는 메인이 계산하므로 비움.',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'title', 'ac', 'writes', 'reads', 'dependsOn'],
        properties: {
          id: { type: 'string' }, title: { type: 'string' },
          ac: { type: 'string', description: '대상 AC id' },
          writes: { type: 'array', items: { type: 'string' }, description: '쓰기 파일 경로' },
          reads: { type: 'array', items: { type: 'string' }, description: '읽기 파일 경로' },
          dependsOn: { type: 'array', items: { type: 'string' }, description: '선행 WU id' },
        },
      },
    },
  },
}
const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scores', 'totalNote', 'graftableIdeas'],
  properties: {
    scores: {
      type: 'object', additionalProperties: false,
      required: ['feasibility', 'acCoverage', 'scopeDiscipline', 'patternConsistency'],
      properties: {
        feasibility: { type: 'integer', minimum: 1, maximum: 5, description: '구현가능성(탐색 요약상 실재 파일·순서 타당)' },
        acCoverage: { type: 'integer', minimum: 1, maximum: 5, description: '모든 AC가 work unit에 귀속되는가' },
        scopeDiscipline: { type: 'integer', minimum: 1, maximum: 5, description: '초과구현·범위 이탈 없는가(낮을수록 gold-plating)' },
        patternConsistency: { type: 'integer', minimum: 1, maximum: 5, description: '따를 기존 패턴 준수' },
      },
    },
    totalNote: { type: 'string', description: '강·약점 한 줄 요약' },
    graftableIdeas: { type: 'array', items: { type: 'string' }, description: '다른 초안에 이식할 가치 있는 이 초안만의 좋은 아이디어' },
  },
}

// ── 초안 생성 프롬프트 ─────────────────────────────────────────────
function draftPrompt(angle) {
  return `당신은 ${A.taskId || '작업'}의 독립 구현 계획 설계자입니다. 다른 설계자와 결과를 공유하지 않습니다.
우선순위 관점: **${angle.key}** — ${angle.focus}

요구사항/AC:
${A.acList}

따를 기존 패턴:
${A.patternsExcerpt || '(없음)'}

탐색 요약(저장소 실제 구조 — 추측 금지, 이 범위 안에서만 계획):
${A.explorationSummary || '(탐색 요약 미제공 — AC와 패턴만으로 설계)'}

${A.projectContext ? '프로젝트 컨텍스트: ' + A.projectContext : ''}
${A.reworkLogExcerpt ? '과거 실수(회피): ' + A.reworkLogExcerpt : ''}

규칙:
- **${angle.key} 관점을 일관되게** 적용한 계획을 설계하라.
- 모든 AC가 최소 하나의 work unit에 귀속되게 분해하라.
- work unit의 writes/reads는 **파일 경로 단위**(심볼 아님). 탐색 요약에 없는 파일은 추정하지 말고 reason에 "신규 파일" 명시.
- wave는 비워라(메인이 writes/reads/의존으로 결정론 계산).
- 초과구현·추측성 확장 금지. AC 밖 변경은 risks에 사유 없이는 넣지 마라.`
}

function judgePrompt(draft, idx) {
  return `당신은 구현 계획 심사위원입니다. 아래 계획안 하나를 채점하세요. 작성자를 신뢰하지 말고 탐색 요약·AC 기준으로 판정합니다.

요구사항/AC:
${A.acList}

따를 기존 패턴:
${A.patternsExcerpt || '(없음)'}

탐색 요약(실재 기준):
${A.explorationSummary || '(미제공)'}

심사 대상 계획안 #${idx + 1} [${draft._angle}]:
${JSON.stringify({ summary: draft.summary, changeFiles: draft.changeFiles, sequence: draft.sequence, risks: draft.risks, workUnits: draft.workUnits }, null, 1)}

4개 차원을 1~5로 채점(5=최상): 구현가능성·AC커버리지·범위절제·패턴일관성.
이 초안에만 있는 **이식 가치 아이디어**도 적어라(합성 시 최고안에 접목).
정적 계획이므로 저장소 직접 Read는 불필요 — 탐색 요약 텍스트 논리로 판정.`
}

// ── 1단계: 관점별 독립 초안 생성 (병렬) ───────────────────────────
const angles = anglesFor(numDrafts)
log(`plan-judge 시작 — 규모 ${scale}, 초안 ${angles.length}개 (${angles.map(a => a.key).join(', ')})`)

const drafts = (await parallel(
  angles.map((angle) => () =>
    agent(draftPrompt(angle), {
      label: `draft:${angle.key}`,
      phase: 'Draft',
      schema: DRAFT_SCHEMA,
    }).then(d => (d ? { ...d, _angle: angle.key } : null))
  )
)).filter(Boolean)

if (drafts.length === 0) {
  throw new Error('plan-judge: 초안 생성 전무 — 입력(acList/explorationSummary) 점검 필요.')
}

// 초안 1개(S 또는 단일)면 채점 생략, 그대로 추천 반환.
if (drafts.length === 1) {
  log('초안 1개 — 채점 생략, 단일 추천 반환')
  return {
    recommended: 0,
    drafts: drafts.map(d => ({ angle: d._angle, ...stripMeta(d) })),
    synthesisGuidance: '단일 초안. 그대로 채택하되 메인이 wave 분해 수행.',
  }
}

// ── 2단계: 초안별 병렬 채점 (judge panel) ─────────────────────────
log(`[Judge] 초안 ${drafts.length}개 채점`)
const judged = await parallel(
  drafts.map((draft, idx) => () =>
    agent(judgePrompt(draft, idx), {
      label: `judge:${draft._angle}`,
      phase: 'Judge',
      schema: JUDGE_SCHEMA,
    }).then(j => ({ idx, angle: draft._angle, judgement: j }))
  )
)

// 합산 점수(4차원 동일 가중) → 최고안 선정.
function total(j) {
  if (!j || !j.judgement) return -1
  const s = j.judgement.scores
  return s.feasibility + s.acCoverage + s.scopeDiscipline + s.patternConsistency
}
const ranked = judged.filter(j => j && j.judgement).sort((a, b) => total(b) - total(a))
if (ranked.length === 0) {
  log('채점 전무 — 첫 초안 추천(폴백)')
  return {
    recommended: 0,
    drafts: drafts.map(d => ({ angle: d._angle, ...stripMeta(d) })),
    synthesisGuidance: '채점 실패 — 첫 초안 채택. 메인이 wave 분해 수행.',
  }
}
const best = ranked[0]
const graft = ranked.slice(1).flatMap(r => (r.judgement.graftableIdeas || []).map(g => `[${r.angle}] ${g}`))

log(`최고안 #${best.idx + 1} [${best.angle}] (합산 ${total(best)}/20) — 이식 아이디어 ${graft.length}건`)

// ── 반환: 최종 작성·wave 분해는 메인 (seam 계약: 워크플로는 산출만) ──
return {
  recommended: best.idx,
  bestAngle: best.angle,
  bestScore: total(best),
  drafts: drafts.map((d, i) => ({
    idx: i, angle: d._angle, ...stripMeta(d),
    scores: (judged.find(j => j && j.idx === i) || {}).judgement?.scores || null,
    note: (judged.find(j => j && j.idx === i) || {}).judgement?.totalNote || null,
  })),
  synthesisGuidance:
    `최고안 #${best.idx + 1}[${best.angle}]을 기반으로 작성하되, 아래 이식 아이디어를 검토해 접목:\n` +
    (graft.length ? graft.map(g => `- ${g}`).join('\n') : '- (없음)') +
    `\n그 후 메인이 3-B(writes/reads 확정 → 의존 → wave 결정론 계산)를 수행한다.`,
}

// 초안에서 내부 메타(_angle) 제거 후 노출.
function stripMeta(d) {
  const { _angle, ...rest } = d
  return rest
}
