export const meta = {
  name: 'forge-flow-review-req',
  description: 'forge-flow 요구검증 — 관점별 독립 검증자 fan-out + completeness critic + 적대적 확정. 단일패스(정적 design 산출물). 판정만 반환, 상태쓰기는 메인.',
  phases: [
    { title: 'Interrogate' }, // 관점별 심문 검증자
    { title: 'Critic' },      // 누락 비평가 (completeness)
    { title: 'Dedup' },       // 동일 근본이슈 병합 (텍스트 병합만)
    { title: 'Refute' },      // finding 적대적 확정
  ],
}

// ── 입력 (메인스레드가 args로 주입) ───────────────────────────────
// args = {
//   taskId, scale: 'S'|'M'|'L',
//   strength: number,        // 관점(검증자) 수. 미설정 시 규모기본
//   projectContext: string,  // CLAUDE.md 스택/구조 요약 (≤3줄)
//   designDoc: string,       // design 문서 전문 (검증 대상 정적 산출물)
//   reworkLogExcerpt: string,// 과거 요구 결함 패턴 발췌 (있으면)
//   perspectives: string[]?  // 검증 관점 오버라이드
// }
// 주의: 수렴 루프 없음. design은 정적 산출물 — 수정은 하네스에서(사용자 design 편집 후 재실행).
// args는 문자열(JSON)로 도달할 수 있음 → 방어적 파싱 필수 (미파싱 시 전 필드 undefined → 폴백 FS 크롤 폭주).
let A = args || {}
if (typeof A === 'string') {
  try { A = JSON.parse(A) } catch (e) { throw new Error('review-req: args 파싱 실패 — ' + e.message) }
}
// fail-fast: design 미주입 시 즉시 중단 (에이전트 FS 크롤 → 타프로젝트 환각 방지).
if (!A.designDoc || !String(A.designDoc).trim()) {
  throw new Error('review-req: designDoc 미주입 — 메인이 design 문서 전문을 args.designDoc로 주입해야 함.')
}
const scale = A.scale || 'M'
const SCALE_DEFAULT_STRENGTH = { S: 1, M: 3, L: 4 }
let strength = A.strength || SCALE_DEFAULT_STRENGTH[scale] || 3
// 비용 floor: plan이 저위험 trivial 과제(순수로직·외부의존/API/DB/UI/보안 없음·테스트로 검증가능)로 판정 시 lightweight.
// 규모(크기)와 직교한 복잡도 게이트 — 관점 1개 + critic 스킵 + refuter 1로 fan-out 비용 대폭 절감.
// 기본 false(보수적). 게이트 편향(결함유지)은 유지: refuter 1이라도 불확실=결함유지.
const lightweight = A.lightweight === true
if (lightweight) strength = 1

// ── 검증 관점 (req 심문) ──────────────────────────────────────────
// 강도 = 동시 검증자 수. 관점풀에서 strength개 선택, 부족하면 순환.
const PERSPECTIVE_POOL = A.perspectives || [
  '완전성: 각 AC가 코드로 검증가능한 구체조건인가, AC 누락·모호(2해석+)·엣지케이스(경계·null·실패경로) 누락 검출',
  '실현성: 기술적 실현가능성, 기존코드와 영향범위가 충분히 식별됐는가, 누락된 영향 모듈',
  '일관성: 요구사항 간 모순·충돌, 제외범위↔변경범위 모순, 가정과 AC 충돌',
  '전파: 변경 전파 체인 — 영향 받는 모듈/서비스 간 연쇄 영향이 AC에 반영됐는가',
]
function perspectivesFor(n) {
  const out = []
  for (let i = 0; i < n; i++) out.push(PERSPECTIVE_POOL[i % PERSPECTIVE_POOL.length])
  return out
}

// 공격적 모드 (A.aggressive=true): 예산 여유만큼 검증자 증원 (관점풀 상한).
// 산정은 verify.js 226638a 수정공식 재사용: floor(remaining/120k), scale 기본 밑으론 안 내림.
if (A.aggressive && budget && budget.total) {
  const affordable = Math.floor(budget.remaining() / 120_000)
  strength = Math.min(Math.max(strength, affordable), PERSPECTIVE_POOL.length)
}

// ── 스키마 (verify와 동일 구조 — seam 일관성) ─────────────────────
const VERIFIER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'summary'],
  properties: {
    summary: { type: 'string', description: 'PASS 항목 한 줄 요약' },
    findings: {
      type: 'array',
      description: '문제 항목만. 없으면 빈 배열.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ac', 'severity', 'problem', 'location', 'fix'],
        properties: {
          ac: { type: 'string', description: '관련 AC id 또는 범위' },
          severity: { type: 'string', enum: ['REWORK', 'CONCERNS'] },
          problem: { type: 'string' },
          location: { type: 'string', description: 'design 섹션/AC id (예: AC-2, ## 제외 범위)' },
          fix: { type: 'string', description: '수정 제안' },
        },
      },
    },
  },
}
const REFUTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reason'],
  properties: {
    refuted: { type: 'boolean', description: '반박 성공(=실제 문제 아님)이면 true. 불확실하면 false(보수적).' },
    reason: { type: 'string' },
  },
}

// ── 중복 병합 스키마 (finding 형태 유지) ──────────────────────────
const DEDUP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['merged'],
  properties: {
    merged: {
      type: 'array',
      description: '동일 근본이슈를 1건으로 병합한 정규 findings.',
      items: VERIFIER_SCHEMA.properties.findings.items,
    },
  },
}
function dedupPrompt(findings) {
  return `여러 독립 검증자가 제기한 요구사항 findings 목록이다. **동일 근본이슈만 1건으로 병합**하라.

## findings (JSON)
${JSON.stringify(findings, null, 1)}

## 규칙
- **같은 근본이슈만 병합**: 같은 결함을 다른 표현으로 지적한 항목들을 1건으로 합쳐라.
- **다른 이슈는 분리 유지**: 같은 AC를 건드려도 서로 다른 결함이면(예: 'AC-2 실패경로 미정의' vs 'AC-2↔제외범위 모순') 별개로 둔다.
- **불확실하면 분리 유지** (과병합 금지 — 게이트는 결함 누락이 더 위험).
- 병합 시 severity는 가장 높은 것(REWORK>CONCERNS) 채택, location/fix는 합산해 보존.
- **유효성 판단 금지**: 진짜 결함인지 아닌지(keep/drop)는 판단하지 마라 — 그건 다음 단계 몫. 너는 텍스트 병합만.
- 입력에 있던 결함 정보를 누락하지 마라.`
}

// ── 검증자 프롬프트 ───────────────────────────────────────────────
function verifierPrompt(perspective) {
  return `당신은 ${A.taskId || '작업'}의 독립 요구사항 검증자입니다. 다른 검증자와 결과를 공유하지 않습니다.
검증 관점: ${perspective}

## 프로젝트 컨텍스트
${A.projectContext || '(없음)'}

## design 문서 (검증 대상)
${A.designDoc}

## 반복 실수 패턴 (해당 시 특히 주의)
${A.reworkLogExcerpt || '(없음)'}

## 지시
- 위 관점에서만 검증. 필요 시 저장소 파일을 직접 읽어 실현성/영향범위 확인.
- PASS 항목은 summary 한 줄. 문제만 findings에 담아라.
- severity: AC 불명확·누락·모순·영향도 누락 = REWORK / 표현 개선 수준 경미 = CONCERNS.
- 추측 금지. design 원문 근거(AC id/섹션) 없는 지적은 만들지 마라.`
}

// ── completeness critic (누락 비평가) ─────────────────────────────
// 관점 검증자가 "있는 것"을 검증한다면, critic은 "없는 것"을 찾는다.
function criticPrompt() {
  return `당신은 ${A.taskId || '작업'}의 요구사항 완전성 비평가입니다.
관점 검증자들과 독립적으로, **누락된 것**만 찾아라.

## 프로젝트 컨텍스트
${A.projectContext || '(없음)'}

## design 문서
${A.designDoc}

## 지시 — 다음을 자문하고 누락만 findings에 담아라
- 명시되지 않은 AC가 있는가? (요구사항이 암시하나 AC로 적히지 않은 동작)
- 고려 안 된 실패 경로/엣지케이스가 있는가?
- 제외 범위·가정이 비어있거나 불충분한가?
- 검증 방법이 각 AC를 실제로 커버하는가?
누락 없으면 findings 빈 배열 + summary 한 줄. severity: 핵심 누락=REWORK / 보완 권장=CONCERNS.
추측 금지 — design 원문 대조로 실제 누락만.`
}

// ── 적대적 확정 (false positive 제거, 게이트 = 결함유지 편향) ──────
function refutePrompt(f) {
  return `검증자가 제기한 요구사항 문제를 반박하라(REFUTE). 확실히 오판일 때만 refuted=true.
문제: [${f.severity}] ${f.problem}
위치: ${f.location} | AC: ${f.ac} | 제안수정: ${f.fix}

design 문서를 직접 확인하여 판단하라:
- design 원문이 지적과 일치하나? 해당 AC/섹션이 실재하나?
- 진짜 요구 결함(모호·누락·모순)인가, 검증자 오판인가?
**이것은 요구 게이트다 — 결함 누락이 오탐보다 위험.** 불확실하면 refuted=false (결함 유지).
명백히 오판·존재하지 않는 위치·기준 오해일 때만 refuted=true.`
}

// ── 단일패스: 관점 fan-out + critic → refute 확정 → verdict ────────
log(`review-req 시작 — 규모 ${scale}, 관점 ${strength}개${lightweight ? ' (lightweight: critic 생략)' : ' + completeness critic 1'}`)

const perspectives = perspectivesFor(strength)
const raw = await parallel([
  ...perspectives.map((p, i) => () =>
    agent(verifierPrompt(p), {
      label: `req:${p.slice(0, 8)}`,
      phase: 'Interrogate',
      schema: VERIFIER_SCHEMA,
    })
  ),
  // lightweight면 completeness critic 생략 (저위험 trivial — 관점 1개로 충분).
  ...(lightweight ? [] : [() => agent(criticPrompt(), { label: 'req:critic', phase: 'Critic', schema: VERIFIER_SCHEMA })]),
])
const findings = raw.filter(Boolean).flatMap(r => r.findings || [])

if (findings.length === 0) {
  log('관점·critic 전원 클린 — PASS')
  return { verdict: 'PASS', findings: [] }
}

// ── 중복 병합 (배리어): 동일 근본이슈 → 1건. 텍스트 병합만, refute 비용/리포트 중복 절감 ──
log(`제기 ${findings.length}건 — 중복 병합`)
let canonical = findings
if (findings.length > 1) {
  const reworkBefore = findings.filter(f => f.severity === 'REWORK').length
  const d = await agent(dedupPrompt(findings), { label: 'req:dedup', phase: 'Dedup', schema: DEDUP_SCHEMA })
  if (d && Array.isArray(d.merged) && d.merged.length > 0) canonical = d.merged
  // 안전망: dedup은 refute 상류 단일 에이전트(다수결 없음). REWORK 감소는 정상(중복 병합)일 수도,
  // 위험(서로 다른 REWORK 누락)일 수도 — 게이트 편향(결함 누락 위험)상 감소를 관측 가능하게 로깅.
  const reworkAfter = canonical.filter(f => f.severity === 'REWORK').length
  if (reworkAfter < reworkBefore) log(`⚠ dedup REWORK ${reworkBefore}→${reworkAfter} 감소 — 누락 아닌 중복병합인지 확인`)
  log(`병합 후 ${canonical.length}건 → refute`)
}

// 적대적 확정: finding당 회의론자 다수 refute, 엄격 과반 반박이면 false positive로 폐기
const REFUTERS = lightweight ? 1 : (scale === 'L' ? 3 : 2)
const confirmed = (await parallel(
  canonical.map(f => () =>
    parallel(
      Array.from({ length: REFUTERS }, () => () =>
        agent(refutePrompt(f), { label: `refute:${f.location}`, phase: 'Refute', schema: REFUTE_SCHEMA })
      )
    ).then(votes => {
      const v = votes.filter(Boolean)
      const refutedCount = v.filter(x => x.refuted).length
      const dropped = refutedCount * 2 > v.length // 엄격 과반만 폐기 (게이트 = 결함유지 편향)
      return dropped ? null : f
    })
  )
)).filter(Boolean)

if (confirmed.length === 0) {
  log(`병합 ${canonical.length}건 전원 반박됨(false positive) — PASS`)
  return { verdict: 'PASS', findings: [] }
}

const rework = confirmed.filter(f => f.severity === 'REWORK')
const concerns = confirmed.filter(f => f.severity === 'CONCERNS')
log(`확정 요구결함 ${confirmed.length}건 (REWORK ${rework.length}, CONCERNS ${concerns.length}) — verdict 반환`)
return {
  verdict: rework.length > 0 ? 'REWORK' : 'CONCERNS',
  findings: confirmed,
  rework, concerns,
}
