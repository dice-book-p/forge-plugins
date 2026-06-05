export const meta = {
  name: 'forge-flow-verify',
  description: 'forge-flow verify — 렌즈별 독립 검증자 fan-out + 적대적 확정 + 수렴(0건 라운드까지). 판정만 반환, 상태쓰기는 메인.',
  phases: [
    { title: 'Verify' },   // 라운드별 렌즈 검증자
    { title: 'Refute' },   // finding 적대적 확정
  ],
}

// ── 입력 (메인스레드가 args로 주입) ───────────────────────────────
// args = {
//   taskId, scale: 'S'|'M'|'L',
//   strength: number,        // 검증 강도 (검증자 수). 미설정 시 규모기본
//   convergenceMax: number,  // 수렴 상한 (필요 clean 라운드 수)
//   startRound: number,      // 현재 convergence_round (REWORK 재진입 유지값)
//   projectContext: string,  // CLAUDE.md 스택/구조 + build_commands 요약 (≤3줄)
//   designExcerpt: string,   // ## 요구사항/AC/따를 기존 패턴/검증 방법 발췌
//   gitDiff: string,         // 변경 내용
//   reworkLogExcerpt: string,// rework-log 이번 영향범위 [코드]/[평가] ×2+ 발췌
//   lenses: string[]?        // 검증 렌즈 오버라이드
// }
// args는 문자열(JSON)로 도달할 수 있음 → 방어적 파싱 필수 (미파싱 시 전 필드 undefined → 폴백 FS 크롤 폭주).
let A = args || {}
if (typeof A === 'string') {
  try { A = JSON.parse(A) } catch (e) { throw new Error('verify: args 파싱 실패 — ' + e.message) }
}
// fail-fast: 검증 대상(diff) 미주입 시 즉시 중단 (에이전트 FS 크롤 → 타프로젝트 환각 방지).
if (!A.gitDiff || !String(A.gitDiff).trim()) {
  throw new Error('verify: gitDiff 미주입 — 메인이 변경 diff를 args.gitDiff로 주입해야 함.')
}
const scale = A.scale || 'M'
const SCALE_DEFAULT_STRENGTH = { S: 1, M: 1, L: 2 }
let strength = A.strength || SCALE_DEFAULT_STRENGTH[scale] || 1
const convergenceMax = A.convergenceMax || SCALE_DEFAULT_STRENGTH[scale] || 1
let round = A.startRound || 0
// 비용 floor: 저위험 trivial 변경이면 검증자 1 + refuter 1 (게이트 편향=결함유지 유지).
const lightweight = A.lightweight === true
if (lightweight) strength = 1

// ── 검증 렌즈 (관점 분리) ─────────────────────────────────────────
// 강도 = 동시 검증자 수. 렌즈 풀에서 strength개 선택, 부족하면 순환.
const LENS_POOL = A.lenses || [
  'AC 충족: 각 AC를 코드 위치(file:line)와 1:1 대조, 구현 누락 검출',
  '패턴·사이드이펙트: design "따를 기존 패턴" 일관성, 영향범위, 엣지케이스',
  '외과적 변경: 초과구현(gold-plating)·인접코드 침범·가정 위반·AC 소급불가 라인',
  'TDD·테스트: 신규 함수 테스트 존재/실효성(mock 과다)/테스트 계획 일치',
]
function lensesFor(n) {
  const out = []
  for (let i = 0; i < n; i++) out.push(LENS_POOL[i % LENS_POOL.length])
  return out
}

// 공격적 모드 (A.aggressive=true): 예산 여유만큼 검증자 증원 (렌즈풀 상한).
// 파일럿 디폴트 = conservative-first(증원 안 함). 발동 신뢰성 입증 후 켠다.
// 실측(pilot wf_0c662167): 검증자 1렌즈 풀비용 = refute 증폭 포함 ~82.8k → 120k/렌즈 provision은 ~1.45x 헤드룸(타당).
// 산정: strength = floor(remaining/120k)로 직접. (기존 1+floor는 base 검증자 1명을 무상 추가 →
//       저예산서 한 단계 초과 provision: budget=120k일 때 strength=2(240k 필요)로 하드 예산 한도 도달 위험.)
//       단 scale 기본 강도 밑으론 안 내림(aggressive는 증원 전용).
if (A.aggressive && budget && budget.total) {
  const affordable = Math.floor(budget.remaining() / 120_000)   // 120k당 검증자 1명 provision
  strength = Math.min(Math.max(strength, affordable), LENS_POOL.length)
}

// ── 스키마 ────────────────────────────────────────────────────────
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
          location: { type: 'string', description: 'file:line' },
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
    refuted: { type: 'boolean', description: '반박 성공(=실제 문제 아님)이면 true. 불확실하면 false(보수적, 결함 유지).' },
    reason: { type: 'string' },
  },
}

// ── 검증자 프롬프트 ───────────────────────────────────────────────
function verifierPrompt(lens) {
  return `당신은 ${A.taskId || '작업'}의 독립 검증자입니다. 다른 검증자와 결과를 공유하지 않습니다.
검증 렌즈: ${lens}

## 프로젝트 컨텍스트
${A.projectContext || '(없음)'}

## design 발췌
${A.designExcerpt || '(없음)'}

## 변경 내용 (git diff)
${A.gitDiff}

## 반복 실수 패턴 (해당 시 특히 주의)
${A.reworkLogExcerpt || '(없음)'}

## 지시
- 위 렌즈 관점에서만 검증. 필요 시 저장소 파일을 직접 읽어 확인.
- PASS 항목은 summary 한 줄. 문제만 findings에 담아라.
- severity: AC 미충족·패턴 불일치·소급불가 라인 = REWORK / 코딩스타일 등 경미 = CONCERNS.
- 추측 금지. 코드 증거(file:line) 없는 지적은 만들지 마라.`
}

// ── 적대적 확정 (false positive 제거) ─────────────────────────────
// 게이트 역방향 디폴트: verify는 false negative(결함 누락)가 false positive보다 비쌈.
// → 버그헌팅과 반대로, "불확실하면 결함 유지"(refuted=false 디폴트).
function refutePrompt(f) {
  return `검증자가 제기한 문제를 반박하라(REFUTE). 확실히 오판일 때만 refuted=true.
문제: [${f.severity}] ${f.problem}
위치: ${f.location} | AC: ${f.ac} | 제안수정: ${f.fix}

저장소를 직접 확인하여 판단하라:
- 코드 증거가 지적과 일치하나? 위치가 실재하나?
- design AC/패턴 기준으로 진짜 위반인가, 검증자 오판인가?
**이것은 검증 게이트다 — 결함 누락이 오탐보다 위험.** 불확실하면 refuted=false (결함 유지).
명백히 오판·존재하지 않는 위치·기준 오해일 때만 refuted=true.`
}

// ── 수렴 루프: 0건 라운드를 convergenceMax 만큼 채울 때까지 ───────
// 한 라운드라도 확정 결함 → 즉시 REWORK 반환 (메인이 implement로 라우팅).
log(`verify 시작 — 규모 ${scale}, 강도 ${strength}, 수렴상한 ${convergenceMax}, 시작라운드 ${round}`)

while (round < convergenceMax) {
  const lenses = lensesFor(strength)
  log(`[라운드 ${round + 1}/${convergenceMax}] 검증자 ${lenses.length}명 (신규 팀 교체)`)

  // 렌즈별 독립 검증자 병렬 — 매 라운드 새 팀(이전 결과 미전달)
  const raw = await parallel(
    lenses.map((lens, i) => () =>
      agent(verifierPrompt(lens), {
        label: `verify:r${round + 1}:${lens.slice(0, 10)}`,
        phase: 'Verify',
        schema: VERIFIER_SCHEMA,
      })
    )
  )
  const findings = raw.filter(Boolean).flatMap(r => r.findings || [])

  if (findings.length === 0) {
    round++                              // clean 라운드 → 수렴 카운트 +1
    log(`라운드 클린 — 수렴 ${round}/${convergenceMax}`)
    continue
  }

  // 적대적 확정: finding당 회의론자 다수 refute, 과반 반박이면 false positive로 폐기
  const REFUTERS = lightweight ? 1 : (scale === 'L' ? 3 : 2)
  const confirmed = (await parallel(
    findings.map(f => () =>
      parallel(
        Array.from({ length: REFUTERS }, () => () =>
          agent(refutePrompt(f), { label: `refute:${f.location}`, phase: 'Refute', schema: REFUTE_SCHEMA })
        )
      ).then(votes => {
        const v = votes.filter(Boolean)
        const refutedCount = v.filter(x => x.refuted).length
        // 엄격 과반이 반박해야만 폐기. 동수·소수 반박이면 생존(게이트 = 결함 유지 편향).
        const dropped = refutedCount * 2 > v.length
        return dropped ? null : f
      })
    )
  )).filter(Boolean)

  if (confirmed.length === 0) {
    round++                              // 전부 false positive → clean 처리
    log(`제기 ${findings.length}건 전원 반박됨(false positive) — 수렴 ${round}/${convergenceMax}`)
    continue
  }

  // 확정 결함 존재 → REWORK
  const rework = confirmed.filter(f => f.severity === 'REWORK')
  const concerns = confirmed.filter(f => f.severity === 'CONCERNS')
  log(`확정 결함 ${confirmed.length}건 (REWORK ${rework.length}, CONCERNS ${concerns.length}) — verdict 반환`)
  return {
    verdict: rework.length > 0 ? 'REWORK' : 'CONCERNS',
    round,                               // convergence_round 유지값 (메인이 그대로 기록)
    findings: confirmed,
    rework, concerns,
  }
}

log(`수렴 완료 (${round}/${convergenceMax} clean) — PASS`)
return { verdict: 'PASS', round, findings: [] }
