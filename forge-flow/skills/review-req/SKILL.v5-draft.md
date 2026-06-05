---
name: review-req
description: "요구사항 검수 — Workflow 외부검수(관점 fan-out + completeness critic + 적대적 확정). design 파일 생성 직후 자동 활성화."
---

> **v5 파일럿 드래프트.** 기존 SKILL.md(에이전트팀 산문 ~17K, TeamCreate)를 Workflow 호출로 대체. 라이브 교체 전 검토용.
> **충실도 주의**: verdict/관점독립성/seam 보존. 단 **구 `rework_counts.review-req >= 3 → FAIL` 에스컬레이션은 폐기** — `rework_lifetime` 통일 기준(§7)으로 대체. 구 카운터 산문 복제 금지.
> **수렴 루프 없음**: design은 정적 산출물 — 단일패스 검증. 수정은 하네스에서(사용자 design 편집 후 재실행).
> **규모**: 파일럿은 **conservative-first** (관점 = 워크플로 규모기본 S1/M3/L4). 발동 신뢰성 입증 후 `aggressive` 켜서 budget 연동 증원.

clarify에서 작성된 design 문서의 **요구사항 품질**을 검증. 메인은 Workflow 오케스트레이션 + verdict 라우팅만, design 평가는 Workflow 검증자에 위임.

> **하네스 원칙**: 생산자 ≠ 평가자. 메인(clarify에서 design 작성)은 오케스트레이터, design 직접 평가 안 함.

---

## 1. 선행 조건 검사 (메인)

1. 세션 바인딩 상태파일 탐색 (`.forge-flow/state/`에서 `session_id` == `${CLAUDE_SESSION_ID}`인 `{task_id}.json`) → 없으면 "워크플로 미시작. `/forge-flow:clarify`로 시작."
2. `design_file` 존재하는 파일 경로 → 없으면 "설계 문서 없음. `/forge-flow:clarify`를 먼저 실행."
3. `phase` ∈ {`clarifying`, `reviewing-req`} → 아니면 "현재 {phase} 단계. clarify 완료 후 review-req."

> **실행 조건**: S/M/L 모두 항상 실행 (규모 무관).

## 2. 상태파일 갱신 (시작)

```json
{ "phase": "reviewing-req" }
```
카운터 의미 (verify/test와 통일):
- `rework_counts.review-req`: 라운드 내 REWORK 횟수. PASS/재시도 시 0 리셋. (라운드/재진입 마커)
- `rework_lifetime.review-req`: 작업 전체 누적(리셋 없음). **에스컬레이션 단일 기준**.

최초 진입 판단: `rework_counts.review-req`==0(또는 미존재) → 최초(0 세팅). `>0`이면 REWORK 후 재진입 → 유지.

## 3. 검증 설정 읽기 (메인)

design `## 검증 설정`에서:
- **검증 강도**(=관점/검증자 수): 미설정 시 워크플로 규모기본 S=1 / M=3 / L=4. 최소 1.
- 최초 진입 1회만 `AskUserQuestion`으로 변경 여부 확인. REWORK 재진입 시 안 물음.

> **수렴 없음**: design은 정적 산출물 — 관점 fan-out + completeness critic 단일패스 → 적대적 확정 → verdict. 반복은 하네스(사용자 design 수정 후 재호출)에서.

## 4. Workflow 호출 (외부 검수)

`workflows/review-req.js`를 **Workflow 도구로 호출**한다.

> **scriptPath 절대경로 해결 (필수)**: SKILL.md 본문의 `${CLAUDE_PLUGIN_ROOT}`는 모델이 읽는 마크다운/셸 환경 모두에서 확장 보장 안 됨. cold 세션에선 스킬 파일 절대경로도 안 주어짐. 아래 순서로:
> 1. **(권장) glob**: `ls -d ~/.claude/plugins/marketplaces/*/forge-flow/workflows/review-req.js` → 정확히 1개면 그 경로. 프로젝트-로컬 대비 `.claude/plugins/marketplaces/*/forge-flow/workflows/review-req.js`도 확인. **0개**: 미설치 보고·중단. **2개+**: 설치 마켓플레이스 일치 우선, 모호하면 사용자 확인.
> 2. **(캐시) `.forge-flow/config.json`의 `plugin_root`**: 존재 시 `<plugin_root>/forge-flow/workflows/review-req.js`. 1번 결과를 여기 1회 기록해두면 재사용.

> **🔴 disk>diff 요건 (advisor, 검증자 디스크 직접 Read)**: review-req 검증자(실현성/전파 관점)는 design 검증 중 **저장소 파일을 직접 읽어** 실현성·영향범위를 확인한다. 따라서 **반드시 워크플로 cwd=대상 repo이거나, `projectContext`에 대상 repo 절대 루트를 명시**해야 한다(아래 args처럼). 누락 시 에이전트가 경로를 탐색하다 home cwd FS 크롤 폭주 → 타프로젝트 환각 재발(과거 namdomarket AC-9 사고). 정적 design만으로 판정 가능한 관점(완전성/일관성)은 designDoc 텍스트로 충분하나, 절대 루트는 항상 주입한다.

```
Workflow({
  scriptPath: "<해결한 절대경로>/workflows/review-req.js",
  args: {
    taskId, scale,                       // 상태파일
    strength,                            // §3 검증설정 (미설정 시 워크플로 규모기본)
    projectContext: "<CLAUDE.md 스택/구조 요약 ≤3줄 + '대상 저장소 루트=<절대경로>'>",
    designDoc: "<design 문서 전문 — 검증 대상 정적 산출물>",
    reworkLogExcerpt: "<rework-log 과거 요구 결함 패턴 발췌, 없으면 ''>"
  }
})
```

> **이 스킬은 위 Workflow를 반드시 호출한다** (opt-in 충족: 스킬 지시문 경로).
> Workflow는 판정만 반환 — 관점별 독립 검증자 + completeness critic 병렬 → dedup 배리어(동일 근본이슈 텍스트병합) → finding당 적대적 확정(엄격 과반 반박만 폐기, 불확실=결함유지) → verdict.
> 완료 `<task-notification>` 수신 = verdict 도착 신호.

## 5. Workflow throw 처리 (wiring 버그 ≠ content REWORK) — 신규

**인식 신호 (실측 wf_8c313ee9)**: Workflow throw는 완료 `<task-notification>`에서 **`<status>failed</status>`**(≠`completed`) + `<summary>`에 `… failed: Error: <원문>`로 표면화된다. `<result>`의 `verdict` 필드는 없다. (fail-fast = `agent_count 0`, ~5ms, FS 크롤 0 — 정상 차단.) 즉 **"status=failed 또는 verdict 필드 부재" = throw**, content verdict 아님.

Workflow가 **에러로 종료**(throw)하면 — 예: `review-req: designDoc 미주입 …` / `args 파싱 실패 …` / scriptPath 해결 실패 — 이것은 **하네스 배선(wiring) 버그이지 design 결함이 아니다.**

- ❌ **rework 카운터 증가 금지**, phase 후퇴 금지, verdict 라우팅(§6) 진입 금지.
- ✅ 에러 메시지로 원인 진단: `designDoc`/`scale`/`scriptPath` 등 **args 주입 누락**을 §4 계약대로 교정 → **같은 단계 재호출**.
- ✅ 2회 연속 throw면 사용자에게 배선 오류 보고(메시지 원문 첨부) 후 중단. design 품질과 무관함을 명시.

> 근거: 워크플로는 fail-fast(`if(!A.designDoc) throw`)로 FS 크롤 폭주를 차단한다. throw를 content REWORK로 오인하면 멀쩡한 design을 사용자에게 수정하라고 잘못 안내하게 됨.

## 6. verdict 라우팅 (메인)

Workflow 반환 `{ verdict, findings, rework, concerns }` 해석 (verify와 동일 어휘 — **PASS/CONCERNS/REWORK만**; FAIL은 워크플로가 아니라 §7 하네스 에스컬레이션 결과):

| verdict | 조치 |
|---------|------|
| **PASS** | §8 PASS 상태 기록 → AskUserQuestion 확인 → `/forge-flow:plan` |
| **CONCERNS** | `AskUserQuestion`("경미 이슈, 수용 진행 / 수정 후 재검수") — **비차단**. 수용=PASS 처리(plan 진행), 수정=REWORK 처리 |
| **REWORK** | §7 REWORK 처리 |

> Workflow는 `Date.now()`/사용자대화 불가 → CONCERNS 사용자판단·상태쓰기는 **메인이** 수행 (seam 계약).

## 7. REWORK 처리 (메인)

design은 정적 산출물 → REWORK = **사용자가 design을 수정한 뒤 재검수**.

1. 문제점 보고 (`findings`의 design 섹션/AC id + fix).
2. `rework-log.md` 기록 (차원 태그 `[요구사항]` — clarify 재유입 스캔 어휘와 일치).
3. 카운터: `rework_counts.review-req`+1, `rework_lifetime.review-req`+1.
4. phase → `clarifying`. `stop_count` 리셋 안 함.
5. 사용자에게 design 수정 안내 → 수정 후 `/forge-flow:review-req` 재호출.

**에스컬레이션 — ① 전역 상한 먼저, ② per-gate** (verify/test와 통일):
- **① 전역 상한**: 모든 `rework_lifetime.*` 합산 ≥ **6**이면 per-gate보다 우선. 보고 + `AskUserQuestion`: "clarify 재진입 — 요구사항부터 재검토 (Recommended)" / "현재 게이트 계속". clarify 재진입 → phase=`clarifying`, `rework_counts` 리셋(`rework_lifetime` 유지).
- **② per-gate (`rework_lifetime.review-req` ≥ 3)** — 전역 미달 시: 보고 + `AskUserQuestion`: "요구사항 재검토 후 재시도" / "FAIL로 에스컬레이션".
  - 재시도 → `rework_counts.review-req`=0, phase=`clarifying`.
  - FAIL → phase=`clarifying`, `rework_counts` 리셋(`rework_lifetime` 유지), design 파일 유지한 채 clarify 재실행 안내.

> **구 규칙 폐기**: `rework_counts.review-req >= 3 → FAIL`(pre-7ff73c6)은 쓰지 않는다. 핑퐁이 per-gate 카운터를 리셋시키므로 **누적 `rework_lifetime`**으로만 에스컬레이션.

## 8. 완료 상태 기록 + 다음 단계

PASS(또는 CONCERNS 수용):
```json
{ "phase": "req-reviewed", "stop_count": 0,
  "rework_counts": { "review-req": 0 },
  "rework_lifetime": { "review-req": "<유지>" } }
```
design `## 검수 결과`에 `- review-req: PASS (날짜)`, 상세는 `{task_id}.review.md` 누적.

→ PASS 골격 보고 + `AskUserQuestion`("승인 — plan 진행 (Recommended)" / "재검토 — clarify부터"):
- 승인 → **즉시 `/forge-flow:plan` 호출**.
- 재검토 → phase=`clarifying`, clarify 재실행.

---

## v5 변경 요약 (기존 대비)

| 항목 | 기존 | v5 |
|------|------|-----|
| 검증자 spawn | TeamCreate+Agent 산문 ~434줄 | `workflows/review-req.js` Workflow |
| 중복 처리 | 메인이 수동 숙의 | 스크립트 dedup 배리어(텍스트 병합) |
| 적대적 확정 | 없음 | finding당 N명 refute, **엄격 과반 반박만 폐기 + 불확실=결함유지** — 신규 |
| verdict 어휘 | PASS/CONCERNS/REWORK/FAIL | **PASS/CONCERNS/REWORK** (FAIL=하네스 §7) |
| 에스컬레이션 | `rework_counts.review-req>=3→FAIL` | `rework_lifetime` 통일(전역6 우선·per-gate3) |
| throw 처리 | 해당 없음 | **wiring 버그 ≠ content REWORK** (§5) — 신규 |
| 상태/CONCERNS | 메인 | **메인 유지** (seam 불변) |
