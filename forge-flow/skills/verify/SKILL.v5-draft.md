---
name: verify
description: "작업 종합 검수 — 빌드 검증(메인) + Workflow 외부검수(렌즈 fan-out + 적대적 확정 + 수렴). 구현 완료 시 자동 트리거."
---

> **v5 파일럿 드래프트.** 기존 SKILL.md(에이전트팀 산문 ~17K)를 Workflow 호출로 대체. 라이브 교체 전 검토용.
> **충실도 주의**: verdict/강도/독립성/seam은 보존. 단 **수렴 의미는 의도적으로 재정의** — 아래 §3 참조 (원본은 "while round<max"와 "1 clean round 조기종료"가 자체 모순이라 그대로 복제 안 함).
> **규모**: 파일럿은 **conservative-first** (검증자 = 원본 기본값, fan-out 증원 안 함). 발동 신뢰성 입증 후 `aggressive` 켜서 budget 연동 증원.

구현 완료 코드를 design 기준 **코드 수준 검증**. 메인은 빌드검증(기계적) + Workflow 오케스트레이션만, 코드 평가는 Workflow 검증자에 위임.

> **하네스 원칙**: 생산자 ≠ 평가자. 메인은 오케스트레이터(빌드 + Workflow 호출 + verdict 라우팅), 코드 직접 평가 안 함.
> 런타임 테스트(브라우저/API)는 verify 아닌 test 영역.

---

## 1. 선행 조건 검사 (메인)

1. 세션 바인딩 상태파일 탐색 (`session_id` == `${CLAUDE_SESSION_ID}`) → 없으면 "워크플로 미시작. /forge-flow:clarify로 시작."
2. `phase` ∈ {`implementing`, `verifying`} → 아니면 "현재 {phase} 단계. 구현 완료 후 verify."
3. `design_file` 존재 → 없으면 "설계 문서 없음."
4. **단위검증 미실행 검사** (M/L, design `### work units` 표 있을 때만): 검증방식이 `스킵`이 아닌데 PASS 기록 없는 unit → 차단 안내 또는 사용자 면제(사유 기록). 표 파싱 실패 시 스킵+경고.
5. **단위테스트-TDD RED 기록 검사** (M/L, TDD on): `단위테스트-TDD` unit의 RED 기록 부재 시 차단. 면제 시 사유 기록.

6. **phase drift sanity-check (phase ↔ 실제 산출물 대조)** — drift는 cross-turn 상태(수동편집·크래시·세션재개) 검사라 하네스(SKILL) 책임. 위 1~5 통과 후, §2 상태 갱신 전에 수행:
   - **강신호 → 진입 차단**: `base_branch`가 **설정된 경우** `git diff {base_branch}...HEAD --stat` + `git status --porcelain` 확인. phase가 `verifying`/`implementing`인데 **커밋·미커밋 변경이 모두 0**이면 드리프트로 판단, **진입 차단**: "phase가 `{phase}`인데 `{base_branch}` 대비 변경된 코드가 없습니다. 구현이 실제로 이뤄졌는지, 올바른 작업 디렉토리/브랜치인지 확인하세요." (`base_branch` 미설정 시 이 강신호 검사는 스킵.)
   - **약신호 → 경고 후 진행**: design `## 검수 결과`에 현재보다 **앞선 단계의 PASS 기록**(예: phase=`verifying`인데 `test: PASS`)이 있는데 그 사이 REWORK 기록이 없으면 → 경고 후 진행: "문서에 `{기록단계}` PASS가 있으나 현재 phase는 `{phase}`입니다. 이전 단계가 의도적으로 되돌려졌는지 확인하세요."

> **워크플로 fail-fast로 메울 수 없는 이유**: `verify.js`는 빈 `gitDiff`면 throw하나 — ① 기준이 다름(working diff ≠ `base_branch...HEAD`, 커밋된 구현은 working diff 비어도 정상), ② throw는 `args 교정`으로 안내돼 "구현 안 됨" 진단과 UX 상이, ③ phase 거짓 자체는 in-turn 워크플로가 못 봄. 그래서 본 검사는 SKILL에 유지.

## 2. 상태파일 갱신 (시작)

```json
{ "phase": "verifying" }
```
카운터 의미 (변경 없음):
- `rework_counts.verify`: 라운드 내 REWORK 횟수. PASS/재시도 시 0 리셋.
- `rework_lifetime.verify`: 작업 전체 누적(리셋 없음). 에스컬레이션·경고 기준.
- `convergence_round`: 현재 수렴 라운드. REWORK 시 유지, 0건 후에만 +1.

최초 진입 판단: 이전 phase `implementing` & `rework_counts.verify`==0 → 최초(0 세팅). test REWORK 유입(`rework_counts.verify`==0)이면 `convergence_round`도 0 초기화.

## 3. 검증 설정 읽기 (메인)

design `## 검증 설정`에서:
- **검증 강도**(=검증자 수): 미설정 시 규모기본 S=1 / M=1 / L=2. 최소 1.
- **수렴 상한**(=필요한 **연속 clean 라운드 수**): 미설정 시 S=1 / M=1 / L=2. S는 1 고정.
- 최초 진입 1회만 `AskUserQuestion`으로 변경 여부 확인. REWORK 재진입 시 안 물음.

> **수렴 의미 (재정의, 명시)**: 라운드마다 새 검증자 팀이 독립 검증 → 확정 결함 0건이면 clean 카운트 +1, `convergenceMax`만큼 연속 clean 채우면 PASS. 어느 라운드든 확정 결함 나오면 즉시 REWORK 반환(`convergence_round` 유지). 원본의 "초기 PASS 후 확인 라운드" 2단 구조 대신 **단일 루프**로 통일.

## 4. 빌드 검증 (메인, Workflow 전)

`/forge-flow:build-check` 실행. `config.json`의 `build_commands.fe` 설정 시 `/forge-flow:fe-check`도.
- **빌드 FAIL → 즉시 REWORK** (Workflow 호출 안 함, §7 REWORK 처리로).
- 빌드 PASS → §5 진행.

## 5. Workflow 호출 (외부 검수)

`workflows/verify.js`를 **Workflow 도구로 호출**한다.

> **scriptPath 절대경로 해결 (필수)**: SKILL.md 본문의 `${CLAUDE_PLUGIN_ROOT}`는 훅(셸)에서만 확장되고 **모델이 읽는 마크다운/셸 환경 모두에서 확장 보장 안 됨** (실측: 셸 `$CLAUDE_PLUGIN_ROOT` 비어있음). 또한 cold 세션에선 스킬 파일의 절대경로도 모델에 안 주어지므로 "스킬 파일 경로 상위 2단계" 방식도 불신뢰. 아래 순서로 구해라:
> 1. **(권장) glob 탐색**: `ls -d ~/.claude/plugins/marketplaces/*/forge-flow/workflows/verify.js` 실행 → 정확히 1개면 그 경로 사용. 프로젝트-로컬 설치 대비 `.claude/plugins/marketplaces/*/forge-flow/workflows/verify.js`도 함께 확인.
>    - **0개**: 플러그인 미설치 → 사용자에게 보고, 중단.
>    - **2개 이상**: 설치 플러그인의 마켓플레이스와 일치하는 것 우선, 모호하면 사용자에게 확인.
> 2. **(캐시) `.forge-flow/config.json`의 `plugin_root`**: 존재하면 `<plugin_root>/forge-flow/workflows/verify.js` 사용 (1번 glob 결과를 여기 1회 기록해두면 재호출 시 재사용). 없으면 1번으로 폴백.
> 해결된 절대경로로 `scriptPath` 전달. (경로 해결 실패 = "발동 신뢰성"의 핵심 변수 — pilot journal `wf_0c662167`에서 scriptPath-mode 자체는 입증됨, 미입증분은 cold-context 경로 해결뿐이라 본 절차로 닫음)

```
Workflow({
  scriptPath: "<해결한 절대경로>/workflows/verify.js",
  args: {
    taskId, scale,                       // 상태파일
    strength, convergenceMax,            // §3 검증설정
    startRound: <convergence_round>,     // 상태파일 유지값
    projectContext: "<CLAUDE.md 스택/구조 + build_commands 요약, ≤3줄>",
    designExcerpt: "<design ## 요구사항/AC/따를 기존 패턴/검증 방법 발췌>",
    gitDiff: "<git diff>",
    reworkLogExcerpt: "<rework-log 이번 영향범위 [코드]/[평가] ×2+ 발췌, 없으면 ''>"
  }
})
```

> **이 스킬은 위 Workflow를 반드시 호출한다** (opt-in 충족: 스킬 지시문 경로).
> Workflow는 판정만 반환 — 렌즈별 독립 검증자 병렬 → finding당 적대적 확정(과반 반박=폐기) → 0건 라운드를 수렴상한만큼 채우면 PASS, 확정 결함 나오면 REWORK 즉시 반환.
> 완료 `<task-notification>` 수신 = verdict 도착 신호.

## 6. verdict 라우팅 (메인)

Workflow 반환 `{ verdict, round, findings, rework, concerns }` 해석:

| verdict | 조치 |
|---------|------|
| **PASS** | §8 PASS 상태 기록 → `convergence_round`=`round` → test 호출 |
| **CONCERNS** | `AskUserQuestion`("경미 이슈, 수용 진행 / 수정 후 재검수") — 수용=PASS 처리, 수정=REWORK 처리 |
| **REWORK** | §7 REWORK 처리 (`convergence_round`=반환 `round` 유지) |

> Workflow는 `Date.now()`/사용자대화 불가 → CONCERNS 사용자판단·상태쓰기는 **메인이** 수행 (seam 계약).

## 7. REWORK 처리 (메인, debug-gate)

1. 문제점 보고 (`findings`의 file:line + fix).
2. **debug-gate 루트코즈**: 재현·diff확인·흐름추적 → 루트코즈 가설 1문장 → 최소 단일수정.
3. `rework-log.md` 기록 (가설 포함, 차원 태그 `[코드]` 기본).
4. 카운터: `rework_counts.verify`+1, `rework_lifetime.verify`+1, `convergence_round` **유지**.
5. phase → `implementing`. `stop_count` 리셋 안 함.
6. 코드 수정 → `/forge-flow:verify` 재호출.

**에스컬레이션 — ① 전역 상한 먼저, ② per-gate**:
- **① 전역 상한 (게이트 간 핑퐁 방지)**: `rework_lifetime.verify` + `rework_lifetime.test` (모든 `rework_lifetime.*` 합산) ≥ **6**이면 per-gate보다 우선. 핑퐁은 per-gate 카운터를 리셋시키며 무한 왕복하므로 전역 누적(리셋 없음)으로 검사. 보고 + `AskUserQuestion`: "clarify 재진입 — 요구사항부터 재검토 (Recommended)" / "현재 게이트 계속". clarify 재진입 → phase=`clarifying`, `rework_counts` 리셋(`rework_lifetime` 유지).
- **② per-gate (`rework_lifetime.verify` ≥ 3)** — 전역 미달 시: 보고 + `AskUserQuestion`: "아키텍처 재검토 후 재시도" / "FAIL로 에스컬레이션".
  - 재시도 → `rework_counts.verify`=0, phase=`implementing`.
  - FAIL → phase=`clarifying`, `rework_counts` 리셋(`rework_lifetime` 유지), `convergence_round`=0.

## 8. 완료 상태 기록 + 다음 단계

PASS(수렴완료):
```json
{ "phase": "verified", "stop_count": 0,
  "rework_counts": { "verify": 0 },
  "rework_lifetime": { "verify": "<유지>" },
  "convergence_round": "<최종 round>" }
```
design `## 검수 결과`에 `- verify: PASS (날짜)`, 상세는 `{task_id}.review.md` 누적.

→ 사용자 입력 없이 **즉시 `/forge-flow:test` 호출** (test 스킵조건이면 자동 스킵 → complete).

## Rework Log 관리

> verify/test/complete가 공통 참조하는 규칙(test SKILL "rework-log 기록"·complete 회고가 본 절을 가리킴). REWORK 판정 시 `.forge-flow/rework-log.md`에 패턴 기록 → clarify/plan이 참조해 동일 실수 예방.

**기록 절차**: ① 로그 읽기(없으면 생성) → ② 유사 패턴(같은 원인 유형) 검색 → ③ 있으면 카운트 +1·날짜 갱신 / 없으면 새 항목 추가 → ④ 관리 규칙 적용.

**항목 형식**:
```markdown
## {원인 요약} (×{횟수}) [{차원}]
- 최근: {날짜} | {verify/test/review-req/review-plan}
- 파일: {관련 파일 또는 design 섹션}
- 교훈: {재발 방지 핵심 한 줄}
<!-- first: {최초 발생일} -->
```

**차원 태그** (제목 끝 1개 명시 — clarify는 `[코드]`·`[요구사항]`을 AC 재유입 스캔):
- `[코드]`: 구현 코드 실수 — verify/test REWORK 기본값
- `[평가]`: 검증자/테스터 오판 — 숙의/refute에서 기록
- `[프로세스]`: 워크플로 비효율 — complete 회고
- `[요구사항]`: 요구사항 해석·AC 결함 — **review-req REWORK** + complete 회고
- `[계획]`: 구현계획 결함(전파누락·순서역전·범위침범) — **review-plan REWORK** (v5 신규 차원)
- `[환경]`: 환경/도구 제약 — test 숙의

**관리 규칙**: 최대 15건(초과 시 ×N 최저·동수면 오래된 날짜 순 삭제) / ×1 단발성은 60일 TTL / ×2+ 반복은 TTL 무관 유지.

---

## v5 변경 요약 (기존 대비)

| 항목 | 기존 | v5 |
|------|------|-----|
| 검증자 spawn | TeamCreate+Agent 산문 ~3K줄 | `workflows/verify.js` Workflow |
| 수렴 | 산문 루프 지시 | 스크립트 `while round<max` (의미 재정의, §3) |
| 적대적 확정 | 없음 | finding당 N명 refute, **엄격 과반 반박만 폐기 + 불확실=결함유지**(게이트 역방향) — 신규 |
| 숙의 | 메인이 불일치 수동 분석 | 스크립트 병렬 + 확정 집계 |
| 상태/CONCERNS/빌드 | 메인 | **메인 유지** (seam 불변) |

## 파일럿이 측정하는 것 (범위 한정)

- ✅ **측정**: 스킬 지시 → 모델이 Workflow를 신뢰성 있게 발동하나 / scriptPath 경로해결 / schema verdict 왕복 / 상태기록 seam.
- ❌ **측정 안 됨**: verify는 **읽기전용** → worktree 변경+머지 검증 불가. **build-via-Workflow 결정규칙의 기준 ②는 이 파일럿으로 입증 안 됨.** verify 통과해도 build=Workflow 확정 아님 (별도 쓰기 파일럿 필요).
