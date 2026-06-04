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

> **sanity-check (v5 신규)**: 진입 시 `phase`와 실제 산출물 대조 — `git diff`가 비어있는데 phase가 `implementing/verifying`이면 불일치 경고 후 사용자 확인. (drift 방어, 설계 §5)

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

> **scriptPath 절대경로 해결 (필수)**: SKILL.md 본문의 `${CLAUDE_PLUGIN_ROOT}`는 훅(셸)에서만 확장되고 **모델이 읽는 마크다운에선 확장 보장 안 됨**. 따라서 호출 전 플러그인 루트 절대경로를 직접 구해라:
> 1. 이 스킬 파일 경로(`.../forge-flow/skills/verify/SKILL.md`)에서 상위 2단계 = 플러그인 루트 → `<루트>/workflows/verify.js`.
> 2. 또는 `.forge-flow/config.json`에 `plugin_root`를 1회 기록해 재사용.
> 절대경로로 `scriptPath` 전달. (이 경로 해결 실패 = 파일럿이 측정하려는 "발동 신뢰성"의 핵심 변수)

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
