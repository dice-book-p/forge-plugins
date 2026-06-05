---
name: review-plan
description: "설계 검수 — Workflow 외부검수(judge panel 구현가능성·AC커버리지·전파 + completeness critic + 적대적 확정). L 필수, M 조건부, S 스킵."
---

> **v5 파일럿 드래프트.** 기존 SKILL.md(에이전트팀 산문, TeamCreate)를 Workflow 호출로 대체. 라이브 교체 전 검토용.
> **충실도 주의**: verdict/관점독립성/seam 보존. 단 **구 `rework_counts.review-plan >= 3 → FAIL` 에스컬레이션은 폐기** — `rework_lifetime` 통일 기준(§7)으로 대체. 구 카운터 산문 복제 금지.
> **수렴 루프 없음**: 구현 계획은 정적 산출물 — 단일패스 검증. 수정은 하네스에서(plan 재작성 후 재실행).
> **규모**: 파일럿은 **conservative-first** (관점 = 워크플로 규모기본 M2/L3). 발동 신뢰성 입증 후 `aggressive`.

plan에서 작성된 **구현 계획**이 요구사항과 일치하고 실현 가능한지 검증. 메인은 Workflow 오케스트레이션 + verdict 라우팅만, 계획 평가는 Workflow judge panel에 위임.

> **하네스 원칙**: 생산자 ≠ 평가자. 메인(plan에서 계획 작성)은 오케스트레이터, 계획 직접 평가 안 함.

---

## 1. 선행 조건 검사 (메인)

1. 세션 바인딩 상태파일 탐색 (`.forge-flow/state/`에서 `session_id` == `${CLAUDE_SESSION_ID}`인 `{task_id}.json`) → 없으면 "워크플로 미시작. `/forge-flow:clarify`로 시작."
2. `design_file` 존재 + `## 구현 계획` 섹션 작성됨 → 없으면 "구현 계획 없음. `/forge-flow:plan`을 먼저 실행."
3. `phase` ∈ {`planning`, `reviewing-plan`} → 아니면 "현재 {phase} 단계. plan 완료 후 review-plan."

> **실행 조건 (규모 게이트, SKILL이 결정)**:
> - **L**: 필수 실행.
> - **M**: 조건부 — 구현 계획에 다중 파일/모듈 전파, 의존성 순서, 신규 통합지점 중 하나라도 있으면 실행. 단순하면 스킵 가능(사유 기록).
> - **S**: **스킵** (Workflow 호출 안 함) → 바로 §8 다음 단계(구현)로.

## 2. 상태파일 갱신 (시작)

```json
{ "phase": "reviewing-plan" }
```
카운터 의미 (verify/review-req/test와 통일):
- `rework_counts.review-plan`: 라운드 내 REWORK 횟수. PASS/재시도 시 0 리셋.
- `rework_lifetime.review-plan`: 작업 전체 누적(리셋 없음). **에스컬레이션 단일 기준**.

최초 진입 판단: `rework_counts.review-plan`==0(또는 미존재) → 최초(0 세팅). `>0`이면 REWORK 후 재진입 → 유지.

## 3. 검증 설정 읽기 (메인)

design `## 검증 설정`에서:
- **검증 강도**(=관점/평가자 수): 미설정 시 워크플로 규모기본 M=2 / L=3. 최소 1.
- 최초 진입 1회만 `AskUserQuestion`으로 변경 여부 확인. REWORK 재진입 시 안 물음.

> **수렴 없음**: 계획은 정적 산출물 — judge panel fan-out + completeness critic 단일패스 → 적대적 확정 → verdict. 반복은 하네스(plan 수정 후 재호출)에서.

## 4. Workflow 호출 (외부 검수)

`workflows/review-plan.js`를 **Workflow 도구로 호출**한다. (S 규모는 여기 도달 전 §1에서 스킵)

> **scriptPath 절대경로 해결 (필수)**: `${CLAUDE_PLUGIN_ROOT}`는 모델이 읽는 환경에서 확장 보장 안 됨. 아래 순서로:
> 1. **(권장) glob**: `ls -d ~/.claude/plugins/marketplaces/*/forge-flow/workflows/review-plan.js` → 정확히 1개면 그 경로. 프로젝트-로컬 대비 `.claude/plugins/marketplaces/*/forge-flow/workflows/review-plan.js`도 확인. **0개**: 미설치 보고·중단. **2개+**: 설치 마켓플레이스 일치 우선, 모호하면 사용자 확인.
> 2. **(캐시) `.forge-flow/config.json`의 `plugin_root`**: 존재 시 `<plugin_root>/forge-flow/workflows/review-plan.js`.

> **🔴 disk>diff 요건 (advisor, review-plan에 특히 중대)**: 구현가능성 평가자는 **반드시 저장소 파일을 직접 읽어**(Glob/Grep/Read) 변경 대상 파일 실재·"따를 기존 패턴" 근거·의존성 순서를 확인한다 — 정적 design만으로 판정 불가. 따라서 **워크플로 cwd=대상 repo이거나, `projectContext`에 대상 repo 절대 루트를 명시**해야 한다(아래 args처럼). 누락 시 에이전트가 경로 탐색하다 home cwd FS 크롤 폭주 → 타프로젝트 환각 재발. 절대 루트는 항상 주입한다.

```
Workflow({
  scriptPath: "<해결한 절대경로>/workflows/review-plan.js",
  args: {
    taskId, scale,                       // 상태파일 (M|L만 — S는 §1 스킵)
    strength,                            // §3 검증설정 (미설정 시 워크플로 규모기본)
    projectContext: "<CLAUDE.md 스택/구조 요약 ≤3줄 + '대상 저장소 루트=<절대경로>'>",
    designDoc: "<design 문서 전문 — 반드시 ## 구현 계획 섹션 포함>",
    reworkLogExcerpt: "<rework-log 과거 계획 결함 패턴 발췌, 없으면 ''>"
  }
})
```

> **이 스킬은 위 Workflow를 반드시 호출한다** (opt-in 충족: 스킬 지시문 경로).
> Workflow는 판정만 반환 — judge panel(구현가능성/AC커버리지/전파) + completeness critic 병렬 → dedup 배리어 → finding당 적대적 확정(엄격 과반 반박만 폐기, 불확실=결함유지) → verdict.
> 완료 `<task-notification>` 수신 = verdict 도착 신호.

## 5. Workflow throw 처리 (wiring 버그 ≠ content REWORK) — 신규

**인식 신호 (실측 wf_8c313ee9)**: Workflow throw는 완료 `<task-notification>`에서 **`<status>failed</status>`**(≠`completed`) + `<summary>`에 `… failed: Error: <원문>`로 표면화된다. `<result>`의 `verdict` 필드는 없다. (fail-fast = `agent_count 0`, ~5ms, FS 크롤 0 — 정상 차단.) 즉 **"status=failed 또는 verdict 필드 부재" = throw**, content verdict 아님.

Workflow가 **에러로 종료**(throw)하면 — 예: `review-plan: designDoc 미주입 …` / `args 파싱 실패 …` / scriptPath 해결 실패 — **하네스 배선 버그이지 계획 결함이 아니다.**

- ❌ **rework 카운터 증가 금지**, phase 후퇴 금지, verdict 라우팅(§6) 진입 금지.
- ✅ 에러로 원인 진단: `designDoc`(## 구현 계획 포함 여부)/`scale`/`scriptPath`/절대 루트 누락을 §4 계약대로 교정 → **같은 단계 재호출**.
- ✅ 2회 연속 throw면 사용자에게 배선 오류 보고(원문 첨부) 후 중단. 계획 품질과 무관함 명시.

## 6. verdict 라우팅 (메인)

Workflow 반환 `{ verdict, findings, rework, concerns }` 해석 (**PASS/CONCERNS/REWORK만**; FAIL은 §7 하네스 에스컬레이션):

| verdict | 조치 |
|---------|------|
| **PASS** | §8 PASS 상태 기록 → 즉시 구현 시작 |
| **CONCERNS** | `AskUserQuestion`("경미 이슈, 수용 진행 / 수정 후 재검수") — **비차단**. 수용=PASS 처리(구현 진행), 수정=REWORK 처리 |
| **REWORK** | §7 REWORK 처리 |

> Workflow는 `Date.now()`/사용자대화 불가 → CONCERNS 사용자판단·상태쓰기는 **메인이** 수행 (seam 계약).

## 7. REWORK 처리 (메인)

구현 계획은 정적 산출물 → REWORK = **plan 수정 후 재검수**.

1. 문제점 보고 (`findings`의 계획 항목/파일 + fix).
2. `rework-log.md` 기록 (차원 태그 `[계획]`).
3. 카운터: `rework_counts.review-plan`+1, `rework_lifetime.review-plan`+1.
4. phase → `planning`. `stop_count` 리셋 안 함.
5. plan 수정 → `/forge-flow:review-plan` 재호출.

**에스컬레이션 — ① 전역 상한 먼저, ② per-gate** (verify/review-req/test와 통일):
- **① 전역 상한**: 모든 `rework_lifetime.*` 합산 ≥ **6**이면 per-gate보다 우선. 보고 + `AskUserQuestion`: "clarify 재진입 — 요구사항부터 재검토 (Recommended)" / "현재 게이트 계속". clarify 재진입 → phase=`clarifying`, `rework_counts` 리셋(`rework_lifetime` 유지).
- **② per-gate (`rework_lifetime.review-plan` ≥ 3)** — 전역 미달 시: 보고 + `AskUserQuestion`: "계획 재검토 후 재시도" / "FAIL로 에스컬레이션".
  - 재시도 → `rework_counts.review-plan`=0, phase=`planning`.
  - FAIL → phase=`clarifying`, `rework_counts` 리셋(`rework_lifetime` 유지), design 파일 유지한 채 clarify 재실행 안내.

> **구 규칙 폐기**: `rework_counts.review-plan >= 3 → FAIL`(pre-7ff73c6)은 쓰지 않는다. 누적 `rework_lifetime`으로만 에스컬레이션.

## 8. 완료 상태 기록 + 다음 단계

PASS(또는 CONCERNS 수용, 또는 S 스킵):
```json
{ "phase": "implementing", "stop_count": 0,
  "rework_counts": { "review-plan": 0 },
  "rework_lifetime": { "review-plan": "<유지>" } }
```
design `## 검수 결과`에 `- review-plan: PASS (날짜)` (S 스킵 시 `- review-plan: SKIP (S, 날짜)`), 상세는 `{task_id}.review.md` 누적.

→ 사용자 추가 입력 없이 **즉시 설계대로 구현 시작**. 에이전트팀 활성·plan 팀구성 승인 시 → plan의 "에이전트팀 동적 구성" 절차로 병렬 구현.

---

## v5 변경 요약 (기존 대비)

| 항목 | 기존 | v5 |
|------|------|-----|
| 평가자 spawn | TeamCreate+Agent 산문 ~204줄 | `workflows/review-plan.js` Workflow |
| 중복 처리 | 메인이 수동 숙의 | 스크립트 dedup 배리어(텍스트 병합) |
| 적대적 확정 | 없음 | finding당 N명 refute, **엄격 과반 반박만 폐기 + 불확실=결함유지** — 신규 |
| verdict 어휘 | PASS/CONCERNS/REWORK/FAIL | **PASS/CONCERNS/REWORK** (FAIL=하네스 §7) |
| 에스컬레이션 | `rework_counts.review-plan>=3→FAIL` | `rework_lifetime` 통일(전역6 우선·per-gate3) |
| throw 처리 | 해당 없음 | **wiring 버그 ≠ content REWORK** (§5) — 신규 |
| 구현가능성 검증 | 산문 지시 | 워크플로 평가자 repo 직접 Read (disk>diff, §4) |
| 상태/CONCERNS/S스킵 | 메인 | **메인 유지** (seam 불변) |
