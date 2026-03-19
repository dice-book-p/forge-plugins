---
name: complete
description: "작업 마무리 — test 통과 후 커밋 여부 확인, design 문서 처리, 상태 파일 정리를 수행합니다. test PASS 후 자동 트리거."
---

test(실행 테스트) 통과 또는 스킵 후, 작업을 마무리합니다.
커밋 여부를 확인하고, design 문서 처리 방법을 선택한 뒤, 워크플로 파일을 정리합니다.

## 선행 조건 검사

실행 전 반드시 확인:
1. 현재 세션에 바인딩된 상태 파일 탐색 → `.forge-flow/state/`에서 `session_id`가 현재 세션(`${CLAUDE_SESSION_ID}`)과 일치하는 `{task_id}.json` 파일 탐색 → 없으면: "워크플로가 시작되지 않았습니다. `/forge-flow:clarify`로 시작하세요."
2. phase가 `"tested"` 또는 `"verified"`인지 확인 → 아니면: "현재 `{phase}` 단계입니다. verify/test를 먼저 통과하세요."
3. `design_file`이 존재하는 파일 경로인지 확인 → 없으면: "설계 문서를 찾을 수 없습니다."

> `"verified"` phase는 test가 스킵된 경우 (S규모 + UI AC 없음)에 해당합니다.

## 상태 파일 갱신

실행 시작 시:
```json
{ "phase": "completing" }
```

## 실행 흐름

### 1단계: 변경 내용 요약

작업 결과를 정리하여 표시합니다:

1. **브랜치 정보**: 현재 브랜치명
2. **변경 파일 목록**: `git status`로 변경/신규/삭제 파일 파악
3. **작업 요약**: design 문서의 요구사항 + AC 기반 한 줄 요약
4. **커밋 메시지 초안**: design 문서 기반으로 작성 (conventional commit 형식)

```
[작업 완료 — 커밋 준비]

브랜치: feature/{작업명}
변경 파일: {N}개 (신규 {n1}, 수정 {n2}, 삭제 {n3})
  + src/auth/SocialAuthProvider.java (신규)
  ~ src/auth/LoginService.java (수정)
  - src/auth/OldAuthHelper.java (삭제)

작업 요약: {design 문서의 목적 한 줄}

커밋 메시지 초안:
  feat: {design 문서 기반 요약}
```

### 2단계: 커밋 여부 확인

**AskUserQuestion 호출**:
```
question: "변경 내용을 커밋할까요?"
header: "커밋"
options:
  - label: "커밋 진행 (Recommended)"
    description: "위 내용으로 커밋합니다"
  - label: "커밋 메시지 수정"
    description: "커밋 메시지를 수정한 뒤 커밋합니다"
  - label: "변경 확인 후 결정"
    description: "git diff를 먼저 확인합니다"
  - label: "커밋하지 않음"
    description: "커밋 없이 작업을 마무리합니다"
multiSelect: false
```

- "커밋 진행" → 초안 메시지로 `git add` + `git commit` 실행
- "커밋 메시지 수정" → 사용자에게 메시지 수정 요청 → 수정된 메시지로 커밋
- "변경 확인 후 결정" → `git diff` 표시 → 2단계 재질문
- "커밋하지 않음" → 커밋 스킵, 3단계로 진행

> 커밋 시 변경된 파일만 `git add`합니다. `.forge-flow/` 하위 파일(design, state)은 커밋 대상에서 제외합니다.

### 3단계: design 문서 처리

**AskUserQuestion 호출**:
```
question: "design 문서를 어떻게 처리할까요?"
header: "design 문서"
options:
  - label: "삭제 (Recommended)"
    description: "design 문서를 삭제합니다. 작업 내용은 커밋에 반영되어 있습니다"
  - label: "보관"
    description: ".forge-flow/archive/ 에 이동하여 보관합니다"
multiSelect: false
```

- "삭제" → design 파일 삭제
- "보관" → `.forge-flow/archive/` 디렉토리로 이동 (없으면 생성)

### 4단계: Rework 교훈 기록 (조건부)

design 문서의 `## 검수 이력`에 REWORK 이력이 있는 경우에만 실행합니다. REWORK이 없었으면 이 단계를 스킵합니다.

REWORK 이력에서 교훈을 추출하여 `.forge-flow/rework-log.md`에 기록합니다 (verify SKILL.md의 "Rework Log 관리" 규칙에 따름).

> verify/test REWORK 시점에 이미 기록된 항목이면 중복 기록하지 않습니다.

### 5단계: 정리 + 완료 보고

1. 상태 파일 정리: phase를 `"completed"`로 갱신한 뒤 삭제 (`rm -f .forge-flow/state/{task_id}.json`). 삭제 실패 시에도 훅이 `"completed"` phase를 감지하여 다음 세션에서 자동 정리합니다.
2. 완료 보고:

```
[작업 완료]
  작업: {task_id}
  커밋: {커밋 해시} 또는 "스킵"
  design: {삭제 / archive 보관}
  워크플로 파일 정리 완료
```
