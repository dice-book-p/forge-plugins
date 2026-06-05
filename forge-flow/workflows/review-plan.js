export const meta = {
  name: 'forge-flow-review-plan',
  description: 'forge-flow 계획검증 — judge panel(구현가능성·AC커버리지·범위절제) fan-out + completeness critic + 적대적 확정. 단일패스(정적 계획 산출물). 판정만 반환, 상태쓰기는 메인.',
  phases: [
    { title: 'Judge' },   // 관점별 독립 평가자
    { title: 'Critic' },  // 누락 비평가 (계획 completeness)
    { title: 'Dedup' },   // 동일 근본이슈 병합 (텍스트 병합만)
    { title: 'Refute' },  // finding 적대적 확정
  ],
}

// ── 입력 (메인스레드가 args로 주입) ───────────────────────────────
// args = {
//   taskId, scale: 'M'|'L',     // S는 review-plan 스킵 (SKILL이 결정), Workflow는 M/L만 호출
//   strength: number,           // 관점(평가자) 수. 미설정 시 규모기본
//   projectContext: string,     // CLAUDE.md 스택/구조 요약 (≤3줄)
//   designDoc: string,          // design 문서 전문 — 반드시 ## 구현 계획 섹션 포함 (검증 대상)
//   reworkLogExcerpt: string,   // 과거 계획 결함 패턴 발췌 (있으면)
//   perspectives: string[]?     // 검증 관점 오버라이드
// }
// 주의: 수렴 루프 없음. 계획은 정적 산출물 — 수정은 하네스에서(plan 재작성 후 재실행).
// 주의: verify와 달리 구현가능성 평가자는 저장소를 직접 읽어야 한다(파일 실재·패턴 근거 확인). 프로덕션 cwd=대상repo.
// args는 문자열(JSON)로 도달할 수 있음 → 방어적 파싱 필수 (미파싱 시 전 필드 undefined → 폴백 FS 크롤 폭주).
let A = args || {}
if (typeof A === 'string') {
  try { A = JSON.parse(A) } catch (e) { throw new Error('review-plan: args 파싱 실패 — ' + e.message) }
}
// fail-fast: design(구현 계획 포함) 미주입 시 즉시 중단 (에이전트 FS 크롤 → 타프로젝트 환각 방지).
if (!A.designDoc || !String(A.designDoc).trim()) {
  throw new Error('review-plan: designDoc 미주입 — 메인이 ## 구현 계획 포함 design 전문을 args.designDoc로 주입해야 함.')
}
const scale = A.scale || 'M'
const SCALE_DEFAULT_STRENGTH = { S: 1, M: 2, L: 3 }
let strength = A.strength || SCALE_DEFAULT_STRENGTH[scale] || 2

// ── 검증 관점 (plan judge panel) ──────────────────────────────────
// 강도 = 동시 평가자 수. 관점풀에서 strength개 선택, 부족하면 순환.
const PERSPECTIVE_POOL = A.perspectives || [
  '구현가능성: 변경 대상 파일이 실재하나(Glob/Grep), "따를 기존 패턴" 근거 파일이 실재하고 패턴이 맞나, 변경 순서가 의존성 기반 타당한가, 리스크에 대응방안 있나',
  'AC커버리지: 각 AC가 구현 계획의 어떤 파일/변경에서 충족되나(1:1 매핑), 변경 전파 체인에 누락 파일 없나',
  '전파·영향: 변경이 영향 주는 모듈/서비스 연쇄가 계획에 반영됐나, 통합 지점 누락 없나',
]
function perspectivesFor(n) {
  const out = []
  for (let i = 0; i < n; i++) out.push(PERSPECTIVE_POOL[i % PERSPECTIVE_POOL.length])
  return out
}

// 공격적 모드 (A.aggressive=true): 예산 여유만큼 평가자 증원 (관점풀 상한).
// 산정은 verify.js 226638a 수정공식 재사용: floor(remaining/120k), scale 기본 밑으론 안 내림.
if (A.aggressive && budget && budget.total) {
  const affordable = Math.floor(budget.remaining() / 120_000)
  strength = Math.min(Math.max(strength, affordable), PERSPECTIVE_POOL.length)
}

// ── 스키마 (verify/review-req와 동일 구조 — seam 일관성) ──────────
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
          ac: { type: 'string', description: '관련 AC id 또는 계획 항목' },
          severity: { type: 'string', enum: ['REWORK', 'CONCERNS'] },
          problem: { type: 'string' },
          location: { type: 'string', description: '계획 항목/파일 (예: 구현계획 3단계, src/x.js)' },
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
  return `여러 독립 평가자가 제기한 구현계획 findings 목록이다. **동일 근본이슈만 1건으로 병합**하라.

## findings (JSON)
${JSON.stringify(findings, null, 1)}

## 규칙
- **같은 근본이슈만 병합**: 같은 결함을 다른 표현으로 지적한 항목들을 1건으로 합쳐라.
- **다른 이슈는 분리 유지**: 같은 계획 항목을 건드려도 서로 다른 결함이면(예: '3단계 파일 미존재' vs '3단계 의존순서 역전') 별개로 둔다.
- **불확실하면 분리 유지** (과병합 금지 — 게이트는 결함 누락이 더 위험).
- 병합 시 severity는 가장 높은 것(REWORK>CONCERNS) 채택, location/fix는 합산해 보존.
- **유효성 판단 금지**: 진짜 결함인지 아닌지(keep/drop)는 판단하지 마라 — 그건 다음 단계 몫. 너는 텍스트 병합만.
- 입력에 있던 결함 정보를 누락하지 마라.`
}

// ── 평가자 프롬프트 ───────────────────────────────────────────────
function verifierPrompt(perspective) {
  return `당신은 ${A.taskId || '작업'}의 독립 구현계획 평가자입니다. 다른 평가자와 결과를 공유하지 않습니다.
검증 관점: ${perspective}

## 프로젝트 컨텍스트
${A.projectContext || '(없음)'}

## design 문서 (## 구현 계획 포함 — 검증 대상)
${A.designDoc}

## 반복 실수 패턴 (해당 시 특히 주의)
${A.reworkLogExcerpt || '(없음)'}

## 지시
- 위 관점에서 구현 계획을 검증. **저장소 파일을 직접 Read/Glob/Grep**하여 계획의 파일·패턴 실재를 확인하라.
- 모든 평가자 공통 — 범위 절제 검증: 제외 범위 침범(## 제외 범위 항목이 계획에 포함됐나), 초과 설계(요청 안 한 기능·추상화·인터페이스), 가정 반영(## 가정이 계획 전제/리스크에 명시됐나).
- PASS 항목은 summary 한 줄. 문제만 findings에 담아라.
- severity: AC 미커버·전파 누락·의존순서 역전·제외범위 침범 = REWORK / 순서 조정 등 경미 = CONCERNS.
- 추측 금지. 코드 증거(file:line) 또는 design 원문 근거 없는 지적은 만들지 마라.`
}

// ── completeness critic (누락 비평가) ─────────────────────────────
function criticPrompt() {
  return `당신은 ${A.taskId || '작업'}의 구현계획 완전성 비평가입니다.
관점 평가자들과 독립적으로, **계획에서 빠진 것**만 찾아라.

## 프로젝트 컨텍스트
${A.projectContext || '(없음)'}

## design 문서 (## 구현 계획 포함)
${A.designDoc}

## 지시 — 다음을 자문하고 누락만 findings에 담아라
- AC 중 어떤 구현 단계에도 매핑되지 않은 것이 있는가?
- 변경 전파 체인에 빠진 파일/모듈이 있는가? (호출부, 테스트, 마이그레이션, 설정)
- 리스크는 식별됐으나 대응 단계가 계획에 없는가?
- 통합/롤백/검증 단계가 누락됐는가?
누락 없으면 findings 빈 배열 + summary 한 줄. severity: 핵심 누락=REWORK / 보완 권장=CONCERNS.
추측 금지 — design·저장소 대조로 실제 누락만.`
}

// ── 적대적 확정 (false positive 제거, 게이트 = 결함유지 편향) ──────
function refutePrompt(f) {
  return `평가자가 제기한 구현계획 문제를 반박하라(REFUTE). 확실히 오판일 때만 refuted=true.
문제: [${f.severity}] ${f.problem}
위치: ${f.location} | AC: ${f.ac} | 제안수정: ${f.fix}

design 계획과 저장소를 직접 확인하여 판단하라:
- 계획 원문·코드가 지적과 일치하나? 지적한 파일/항목이 실재하나?
- 진짜 계획 결함(AC 미커버·전파누락·순서역전·범위침범)인가, 평가자 오판인가?
**이것은 계획 게이트다 — 결함 누락이 오탐보다 위험.** 불확실하면 refuted=false (결함 유지).
명백히 오판·존재하지 않는 항목·기준 오해일 때만 refuted=true.`
}

// ── 단일패스: 관점 fan-out + critic → dedup → refute 확정 → verdict ─
log(`review-plan 시작 — 규모 ${scale}, 관점 ${strength}개 + completeness critic 1`)

const perspectives = perspectivesFor(strength)
const raw = await parallel([
  ...perspectives.map((p, i) => () =>
    agent(verifierPrompt(p), {
      label: `plan:${p.slice(0, 8)}`,
      phase: 'Judge',
      schema: VERIFIER_SCHEMA,
    })
  ),
  () => agent(criticPrompt(), { label: 'plan:critic', phase: 'Critic', schema: VERIFIER_SCHEMA }),
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
  const d = await agent(dedupPrompt(findings), { label: 'plan:dedup', phase: 'Dedup', schema: DEDUP_SCHEMA })
  if (d && Array.isArray(d.merged) && d.merged.length > 0) canonical = d.merged
  // 안전망: dedup은 refute 상류 단일 에이전트(다수결 없음). REWORK 감소는 정상(중복 병합)일 수도,
  // 위험(서로 다른 REWORK 누락)일 수도 — 게이트 편향(결함 누락 위험)상 감소를 관측 가능하게 로깅.
  const reworkAfter = canonical.filter(f => f.severity === 'REWORK').length
  if (reworkAfter < reworkBefore) log(`⚠ dedup REWORK ${reworkBefore}→${reworkAfter} 감소 — 누락 아닌 중복병합인지 확인`)
  log(`병합 후 ${canonical.length}건 → refute`)
}

// 적대적 확정: finding당 회의론자 다수 refute, 엄격 과반 반박이면 false positive로 폐기
const REFUTERS = scale === 'L' ? 3 : 2
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
log(`확정 계획결함 ${confirmed.length}건 (REWORK ${rework.length}, CONCERNS ${concerns.length}) — verdict 반환`)
return {
  verdict: rework.length > 0 ? 'REWORK' : 'CONCERNS',
  findings: confirmed,
  rework, concerns,
}
