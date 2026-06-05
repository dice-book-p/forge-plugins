export const meta = {
  name: 'forge-flow-implement',
  description: 'forge-flow implement — wave별 구현자 fan-out(격리 worktree) + wave간 reconciliation 병합. 통합 브랜치에 구현 누적, 요약만 반환. 상태쓰기·verify 전이는 메인.',
  phases: [
    { title: 'Implement' },   // wave별 병렬 구현자
    { title: 'Reconcile' },   // wave 브랜치 통합 병합 + 전체 스위트
  ],
}

// ── 입력 (메인스레드가 args로 주입) ───────────────────────────────
// args = {
//   taskId, scale: 'S'|'M'|'L',
//   repoRoot: string,          // 대상 저장소 절대 경로 (에이전트가 cd; 누락 시 home 크롤 위험 → fail-fast)
//   integrationBranch: string, // 구현 누적 통합 브랜치명 (plan 6단계서 분기한 기능 브랜치)
//   workUnits: [{ id, title, ac, writes:[file...], reads:[file...], verifyMethod, verifyCriteria, dependsOn:[id...], wave:'W0' }],
//   designExcerpt: string,     // ## 구현 계획/AC/따를 기존 패턴 발췌 (구현 지침)
//   patternsExcerpt: string,   // 따를 기존 패턴
//   projectContext: string,    // 스택/빌드 명령 요약
//   reworkLogExcerpt: string,  // 과거 [코드] 실수 회피
// }
// args는 문자열(JSON)로 도달 가능 → 방어적 파싱 (verify.js 계약 동일).
let A = args || {}
if (typeof A === 'string') {
  try { A = JSON.parse(A) } catch (e) { throw new Error('implement: args 파싱 실패 — ' + e.message) }
}
// fail-fast: 대상 저장소·work unit 미주입 시 즉시 중단 (FS 크롤·타프로젝트 환각 방지).
if (!A.repoRoot || !String(A.repoRoot).trim()) {
  throw new Error('implement: repoRoot 미주입 — 메인이 대상 저장소 절대경로를 주입해야 함.')
}
if (!Array.isArray(A.workUnits) || A.workUnits.length === 0) {
  throw new Error('implement: workUnits 미주입 — wave 분해된 work unit 배열 필요.')
}
const integration = A.integrationBranch
if (!integration) throw new Error('implement: integrationBranch 미주입.')
const scale = A.scale || 'M'
const repoRoot = A.repoRoot

// ── wave 그룹핑 (W0, W1, … 순서) ──────────────────────────────────
const waveKey = u => u.wave || 'W0'
const waveNum = w => parseInt(String(w).replace(/^W/, ''), 10) || 0
const waves = [...new Set(A.workUnits.map(waveKey))].sort((a, b) => waveNum(a) - waveNum(b))  // 수치 정렬 (W2 < W10)

// ── 스키마 ────────────────────────────────────────────────────────
const IMPL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['unitId', 'branch', 'status', 'verifyResult', 'note'],
  properties: {
    unitId: { type: 'string' },
    branch: { type: 'string', description: '구현자가 만든 unit 브랜치명 (reconciliation이 병합)' },
    status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED'] },
    verifyResult: { type: 'string', enum: ['PASS', 'FAIL', 'SKIP'], description: '이 unit의 검증방식 실행 결과' },
    note: { type: 'string', description: '구현 요약 또는 BLOCKED/FAIL 사유' },
  },
}
const RECON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['integrationRef', 'mergeStatus', 'suiteStatus', 'conflicts', 'note'],
  properties: {
    integrationRef: { type: 'string', description: '병합 후 통합 브랜치 HEAD 짧은 해시' },
    mergeStatus: { type: 'string', enum: ['CLEAN', 'CONFLICT', 'PARTIAL'] },
    suiteStatus: { type: 'string', enum: ['PASS', 'FAIL', 'SKIP'], description: '전체 빌드/테스트 함께 실행 결과' },
    conflicts: { type: 'array', items: { type: 'string' }, description: '충돌 파일 (P0 disjoint면 빈 배열 기대)' },
    note: { type: 'string' },
  },
}

// ── 구현자 프롬프트 (격리 컨텍스트: unit 전문 인라인, 세션 히스토리 미상속) ──
function implPrompt(unit, baseRef) {
  return `당신은 ${A.taskId || '작업'}의 독립 구현자입니다. 아래 work unit 하나만 구현합니다.

## 격리 작업 절차 (반드시 순서대로)
1. cd ${repoRoot}
2. 격리 worktree 생성: git worktree add -b impl/${A.taskId}/${unit.id} /tmp/ff-impl-${A.taskId}-${unit.id} ${baseRef}
   (경로 충돌 시 -<n> 접미사). 이후 모든 작업은 이 worktree 안에서.
3. **담당 파일만 변경**한다 (아래 writes 목록 외 파일 수정 금지):
   - writes: ${JSON.stringify(unit.writes)}
   - reads (참고만, 변경 금지): ${JSON.stringify(unit.reads || [])}
${/TDD/.test(unit.verifyMethod || '') ? `4. **TDD 순서 강제** (검증방식=${unit.verifyMethod}) — RED→GREEN→REFACTOR를 순서대로:
   - RED: 실패하는 테스트 먼저 작성 → 실행하여 **FAIL 확인**(통과하면 테스트가 무의미 → 다시). FAIL 로그를 note에 기록.
   - GREEN: 테스트를 통과시킬 **최소 구현** → 실행하여 PASS 확인.
   - REFACTOR: 코드 정리(테스트 PASS 유지). 기준: ${unit.verifyCriteria || '—'}
   - 모든 단계 통과 시 verifyResult=PASS. RED에서 FAIL 미관측 또는 GREEN 미달성 → status=BLOCKED, verifyResult=FAIL.`
: `4. 검증방식 실행: ${unit.verifyMethod || '스킵'} / 기준: ${unit.verifyCriteria || '—'}
   - PASS면 verifyResult=PASS, FAIL이면 수정 시도 후 재실행. 못 고치면 status=BLOCKED, verifyResult=FAIL.
   - 검증방식이 '스킵*'이면 verifyResult=SKIP.`}
5. worktree 안에서 커밋: git add -A && git commit -m "${unit.id}: ${unit.title}"
6. 반환: unitId, branch(=impl/${A.taskId}/${unit.id}), status, verifyResult, note(구현 요약).

## 구현 지침
대상 AC: ${unit.ac}
제목: ${unit.title}
${A.patternsExcerpt ? '따를 기존 패턴:\n' + A.patternsExcerpt : ''}
${A.designExcerpt ? '설계 발췌:\n' + A.designExcerpt : ''}
${A.projectContext ? '컨텍스트: ' + A.projectContext : ''}
${A.reworkLogExcerpt ? '과거 실수(회피): ' + A.reworkLogExcerpt : ''}

규칙: 초과구현 금지(AC 밖 변경 금지). writes 목록 밖 파일 건드리지 마라(병렬 안전성 위반). 구현자 보고를 부풀리지 말 것 — 검증 실패는 정직히 FAIL.`
}

// ── reconciliation 프롬프트 (wave 브랜치 통합 병합 + 전체 스위트) ──
function reconPrompt(unitsInfo, baseRef, waveLabel) {
  return `당신은 ${A.taskId || '작업'}의 통합 담당자입니다. ${waveLabel}의 구현 브랜치들을 통합 브랜치에 병합합니다.

## 4단계 reconciliation (superpowers — 순서대로)
1. cd ${repoRoot}
2. **① 각 unit 요약 검토** (병합 전 무엇이 바뀌었나 파악):
   ${JSON.stringify(unitsInfo)}
3. 통합 브랜치 체크아웃: git checkout ${integration} (현재 ${baseRef})
4. **② 편집 충돌 검사 = 순차 병합** (P0 writes 비충돌 보장 → clean 기대):
   위 unit들의 branch를 순서대로 git merge --no-edit <branch>. 충돌 시 충돌 파일 기록(conflicts), 해당 병합 abort(git merge --abort), mergeStatus=CONFLICT/PARTIAL.
5. **③ 전체 스위트 함께 실행** (병합된 통합 상태 — 이게 진짜 게이트):
   ${A.projectContext ? '빌드/테스트: ' + A.projectContext : '저장소 빌드/테스트 명령'}
   PASS/FAIL/SKIP을 suiteStatus로.
6. **④ 체계적 오류 spot-check** (disjoint write라도 의미적 비양립 가능): 병합된 통합 diff에서 unit 간 — 패턴 불일치(같은 일 다른 방식), 헬퍼/타입 중복 정의, 인터페이스 시그니처 어긋남, 명명 규칙 분산 — 을 점검한다. 발견 시 note에 구체 기록(차단 판정은 suite/REWORK가 담당, 본 단계는 관측·보고).
7. 정리: 병합된 각 worktree git worktree remove --force <path> + 병합된 브랜치 git branch -d <branch>(-d는 미병합 거부=안전). 충돌 미병합 브랜치는 보존(REWORK 재사용).
8. 반환: integrationRef(병합 후 ${integration} 짧은 해시), mergeStatus, suiteStatus, conflicts, note(④ spot-check 결과 포함).

병합·검증 결과를 부풀리지 마라. 충돌·스위트 실패·체계적 오류는 정직히 보고.`
}

// ── 실행: wave 순차, wave 내 구현자 병렬, wave 끝 reconciliation ──
log(`implement 시작 — 규모 ${scale}, ${waves.length}개 wave, unit ${A.workUnits.length}개, 통합 ${integration}`)

const done = new Set()        // 완료(병합)된 unit id
const blocked = new Set()     // 실패/차단된 unit id (후속 의존 차단)
const unitResults = []
const reconResults = []
let baseRef = integration     // 다음 wave가 분기할 기준 (wave마다 갱신)

for (const w of waves) {
  const waveUnits = A.workUnits.filter(u => waveKey(u) === w)
  // 의존이 blocked면 이 unit도 차단 (의존 실패 전파).
  const ready = waveUnits.filter(u => !(u.dependsOn || []).some(d => blocked.has(d)))
  const skipped = waveUnits.filter(u => (u.dependsOn || []).some(d => blocked.has(d)))
  skipped.forEach(u => { blocked.add(u.id); unitResults.push({ unitId: u.id, wave: w, status: 'BLOCKED', verifyResult: 'SKIP', note: '의존 unit 실패로 차단' }) })

  if (ready.length === 0) {
    log(`[${w}] 실행 가능 unit 없음 (전부 의존 차단) — 스킵`)
    continue
  }
  log(`[${w}] 구현자 ${ready.length}명 병렬 (base ${baseRef})`)

  // 구현자 병렬 fan-out (각 격리 worktree)
  const implRaw = await parallel(
    ready.map(u => () =>
      agent(implPrompt(u, baseRef), { label: `impl:${u.id}`, phase: 'Implement', schema: IMPL_SCHEMA })
    )
  )
  const impl = implRaw.filter(Boolean)
  impl.forEach(r => unitResults.push({ ...r, wave: w }))

  // 성공(브랜치 생성·검증 통과/스킵) unit만 병합 대상.
  const mergeable = impl.filter(r => r.status !== 'BLOCKED' && r.verifyResult !== 'FAIL' && r.branch)
  impl.filter(r => r.status === 'BLOCKED' || r.verifyResult === 'FAIL').forEach(r => blocked.add(r.unitId))

  if (mergeable.length === 0) {
    log(`[${w}] 병합 가능 unit 없음 (전원 실패) — reconciliation 스킵, 후속 wave 의존 차단`)
    continue
  }

  // wave 끝 reconciliation (단일 통합 담당자 — 순차 병합 + 전체 스위트)
  log(`[${w}] reconciliation — ${mergeable.length}개 브랜치 병합`)
  const recon = await agent(
    reconPrompt(mergeable.map(r => ({ branch: r.branch, unitId: r.unitId, note: r.note })), baseRef, w),
    { label: `reconcile:${w}`, phase: 'Reconcile', schema: RECON_SCHEMA }
  )
  if (recon) {
    reconResults.push({ wave: w, ...recon })
    if (recon.mergeStatus === 'CLEAN' && recon.suiteStatus !== 'FAIL') {
      mergeable.forEach(r => done.add(r.unitId))
      baseRef = recon.integrationRef || integration   // 다음 wave는 병합된 통합 위에 분기
      log(`[${w}] 병합 ${recon.mergeStatus} / 스위트 ${recon.suiteStatus} — 통합 ${baseRef}`)
    } else {
      // 충돌 또는 스위트 실패 → 이 wave unit 차단, 후속 의존 차단. baseRef 유지.
      mergeable.forEach(r => blocked.add(r.unitId))
      log(`⚠ [${w}] 병합 ${recon.mergeStatus} / 스위트 ${recon.suiteStatus} — wave 차단, REWORK 필요`)
    }
  } else {
    mergeable.forEach(r => blocked.add(r.unitId))
    log(`⚠ [${w}] reconciliation 무응답 — 차단`)
  }
}

// ── 반환 (seam 계약: 구현 결과 요약만. 상태쓰기·verify 전이는 메인) ──
const verdict = blocked.size === 0 ? 'COMPLETE'
  : done.size === 0 ? 'FAILED' : 'PARTIAL'
log(`implement 완료 — ${verdict} (완료 ${done.size} / 차단 ${blocked.size} / 통합 ${baseRef})`)
return {
  verdict,                       // COMPLETE | PARTIAL | FAILED — 메인이 verify 진행 or REWORK 라우팅
  integrationBranch: integration,
  integrationRef: baseRef,       // 최종 통합 HEAD (메인이 verify에 gitDiff 근거로)
  done: [...done],
  blocked: [...blocked],         // 비면 REWORK 대상 unit (의존 후속 포함)
  wavesRun: waves.length,
  units: unitResults,
  reconciliation: reconResults,
}
