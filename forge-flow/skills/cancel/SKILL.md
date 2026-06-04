---
name: cancel
description: "현재 forge-flow 작업을 취소/중단합니다. 진행 중 작업을 포기하고 상태·워크트리를 정리합니다. 작업 취소, 중단, abort, 그만, 워크플로 종료 요청 시 사용."
---

진행 중인 forge-flow 작업을 안전하게 취소합니다. 어느 phase에서든 호출 가능하며, 상태 파일을 정리해 미완료 차단(stop-guard)에서 벗어납니다.

> **설계 배경**: 기존 forge-flow는 `cancelled` phase를 참조만 하고 어떤 스킬도 설정하지 않아 정식 abort 경로가 없었습니다. 작업 포기는 clarify에서 새 작업으로 이전 state를 덮어쓰는 우회뿐이었습니다. 이 스킬이 정식 취소 경로입니다.

## 1. 선행 조건 검사

1. 현재 세션 바인딩 상태 파일 탐색 → `.forge-flow/state/`에서 `session_id`가 `${CLAUDE_SESSION_ID}`와 일치하는 `{task_id}.json`.
   - 없으면: 미완료 작업 목록(다른 세션 포함)을 표시하고 "취소할 작업의 task_id를 지정하세요." 안내. 지정 시 해당 state로 진행.
   - 전혀 없으면: "취소할 forge-flow 작업이 없습니다." 후 종료.

## 2. 취소 확인 (필수)

`AskUserQuestion`으로 명시 확인 (되돌릴 수 없음):
```
question: "작업 '{task_id}' (현재 {phase} 단계)를 취소합니다. 진행 내용이 정리됩니다."
header: "작업 취소"
options:
  - label: "취소 진행"
    description: "상태 파일을 정리하고 워크플로를 종료합니다"
  - label: "유지 — 취소 안 함"
    description: "작업을 그대로 두고 계속 진행합니다"
multiSelect: false
```
"유지" 선택 시 아무 변경 없이 종료.

## 3. 워크트리 정리 (work_dir 있을 때만)

상태 파일 `work_dir`가 존재하고 `null`이 아니면 `AskUserQuestion`:
```
question: "이 작업은 워크트리에서 진행되었습니다. 워크트리를 어떻게 할까요?"
header: "워크트리"
options:
  - label: "삭제 (Recommended)"
    description: "워크트리와 미커밋 변경을 삭제합니다"
  - label: "유지"
    description: "워크트리/브랜치를 남겨 나중에 직접 처리합니다"
multiSelect: false
```
- "삭제": `{repo_root} = git -C {work_dir} rev-parse --show-toplevel` 확인 후 `git -C {repo_root} worktree remove --force {work_dir}`. (미커밋 변경 삭제 경고는 위 확인에 포함)
- "유지": 워크트리 그대로 둠.

> `work_dir`가 없으면(메인 세션 작업) 이 단계 스킵. 메인 세션에서 작성한 코드 변경은 **삭제하지 않습니다** — 사용자가 직접 `git restore`/`stash`로 처리하도록 안내만.

## 4. design 문서 처리

- 상태 파일 `keep_design`이 `true`면 design 파일 유지.
- 아니면 `AskUserQuestion`: "design 문서를 남길까요?" (남김 / 삭제). 삭제 선택 시 `rm -f {design_file}`.

## 5. 상태 파일 정리

1. phase를 `"cancelled"`로 갱신 (감사/훅 일관성).
2. 상태 파일 삭제: `rm -f .forge-flow/state/{task_id}.json`.
   - 삭제 실패 시에도 phase가 `cancelled`이므로 다음 세션에서 워크플로 훅이 정리합니다.
3. `stop_count`/`force_passed` 등 잔여 필드는 파일 삭제로 함께 제거됨.

> rework-log(`.forge-flow/rework-log.md`)는 **삭제하지 않습니다** — 학습 자산이므로 보존.

## 6. 완료 보고

```
[작업 취소됨]
  task: {task_id}
  취소 시점 phase: {phase}
  워크트리: 삭제 | 유지 | 해당 없음
  design: 삭제 | 유지
```
취소 후 새 작업은 `/forge-flow:clarify`로 시작.
