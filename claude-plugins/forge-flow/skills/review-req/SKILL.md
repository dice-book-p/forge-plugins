---
name: review-req
description: "요구사항 검수 — clarify 완료 후 design 문서의 품질을 서브에이전트로 교차검증합니다. design 파일 생성 직후 자동 활성화."
---

clarify에서 작성된 design 문서의 요구사항 품질을 서브에이전트 교차검증으로 검수합니다.

## 실행 조건

- **S/M/L 모두** 항상 실행 (규모에 관계없이)
- .forge-flow/design/{작업명}.md 파일이 존재해야 함
- 없으면 → `/forge-flow:clarify` 먼저 실행 안내

## 선행 조건 검사

실행 전 반드시 확인:
1. 상태 파일 존재 → 없으면: "워크플로가 시작되지 않았습니다. `/forge-flow:clarify`로 시작하세요."
2. `design_file`이 존재하는 파일 경로인지 확인 → 없으면: "설계 문서를 찾을 수 없습니다. `/forge-flow:clarify`를 먼저 실행하세요."

## 상태 파일 갱신

실행 시작 시:
```json
{ "phase": "reviewing-req", "stop_count": 0, "rework_count": 0 }
```

## 실행 흐름

### 1단계: design 문서 로드

상태 파일의 `design_file` 경로에서 design 문서를 읽습니다.

### 2단계: 서브에이전트 교차검증

**서브에이전트 생성** (Agent tool, `isolation: "worktree"`, model 생략 → 세션 모델 상속):

서브에이전트에게 전달하는 프롬프트:

```
당신은 요구사항 검수자입니다. 아래 design 문서를 검토하고, 각 항목에 PASS/FAIL + 근거를 반환하세요.

## 검토 항목

1. **AC 검증 가능성**: 각 AC가 코드로 검증 가능한 구체적 조건인가?
   - "잘 되어야 한다" → FAIL (측정 불가)
   - "POST /api → 200 + 필드 X 포함" → PASS (검증 가능)

2. **모호성/모순**: 서로 모순되거나 해석이 2가지 이상 가능한 항목이 있는가?

3. **영향도 파악**: 기존 코드와의 영향 범위가 충분히 식별되었는가?
   - 프로젝트의 관련 코드를 직접 탐색하여 누락 여부 확인

4. **누락된 엣지케이스**: 경계값, null/empty, 실패 경로, 동시성 등 고려 누락은 없는가?

5. **제외 범위 명확성**: 제외 범위가 명시되어 있고, 변경 범위와 모순이 없는가?

## 응답 형식

각 항목에 대해:
- PASS: <근거 한 줄>
- FAIL: <구체적 문제점 + 개선 제안>

## 종합 판정
PASS / CONCERNS / REWORK / FAIL + 근거

[design 문서 내용]
{design 문서 전문}
```

> **핵심 원칙**: 메인 세션의 판단 결과를 서브에이전트에게 전달하지 않음 (독립 판단 보장).

### 3단계: 결과 종합

서브에이전트 결과를 종합하여 4단계 품질 게이트로 판정:

| 등급 | 기준 | 조치 |
|------|------|------|
| **PASS** | 전 항목 PASS | 다음 단계(plan)로 진행 |
| **CONCERNS** | 경미한 이슈 (표현 개선 수준) | `AskUserQuestion`으로 판단 위임. 수용 시 진행 |
| **REWORK** | AC 불명확, 영향도 누락 등 | design 문서 해당 항목 수정 → 재검수 |
| **FAIL** | 근본적 문제 (요구사항 자체 모호) | design 파일 유지한 채 clarify부터 재실행 |

> **REWORK 연속 3회 시 FAIL로 에스컬레이션**: 같은 항목이 반복 실패하면 요구사항 자체에 문제가 있을 가능성 높음.

**REWORK 처리 흐름**:
1. 문제점을 사용자에게 보고
2. 상태 파일의 `rework_count`를 +1 (`rework_count` ≥ 3이면 FAIL로 에스컬레이션)
3. phase를 `"clarifying"`으로 되돌림
4. 사용자가 design 문서 수정
5. 수정 완료 후 다시 `/forge-flow:review-req` 실행 (workflow-state 훅이 현재 phase를 안내)

### 4단계: 결과 기록

design 문서의 `## 검수 결과`, `## 검수 이력` 섹션에 기록:

```markdown
## 검수 결과
- review-req: PASS (2026-03-13)

## 검수 이력
### review-req
- #1 CONCERNS: AC-3 "응답시간 500ms 이내" → 측정 기준 모호
  → 수용: "p95 기준 500ms"로 구체화
```

## 상태 파일 갱신 (완료 시)

PASS 시:
```json
{ "phase": "reviewing-req", "stop_count": 0, "rework_count": 0 }
```

REWORK 시:
```json
{ "phase": "clarifying", "rework_count": +1 }
```
> `rework_count`는 REWORK 판정마다 +1. 3 이상이면 FAIL로 에스컬레이션.
> `stop_count`는 REWORK/FAIL 후퇴 시 리셋하지 않습니다.

## 완료 후 다음 단계

review-req PASS 후, **사용자에게 결과를 보고하고 `AskUserQuestion`으로 확인**합니다:

```
[요구사항 검수 완료]
판정: PASS
검수 항목 요약:
  - AC 검증 가능성: PASS
  - 모호성/모순: PASS
  - 영향도 파악: PASS
  - 엣지케이스: PASS
  - 제외 범위: PASS
```

**AskUserQuestion 호출**:
```
question: "요구사항 검수를 통과했습니다. 어떻게 진행할까요?"
header: "검수 승인"
options:
  - label: "승인 — plan 진행 (Recommended)"
    description: "구현 계획 수립으로 진행합니다"
  - label: "수정 필요"
    description: "요구사항을 일부 수정한 뒤 재검수합니다"
  - label: "재검토 — clarify부터"
    description: "요구사항을 처음부터 다시 정리합니다"
multiSelect: false
```

- "승인" → **즉시 `/forge-flow:plan`을 호출**하여 구현 계획을 설계합니다.
- "수정 필요" / Other → design 문서 수정 후 재검수.
- "재검토" → phase를 `"clarifying"`으로 되돌리고 clarify 재실행.
