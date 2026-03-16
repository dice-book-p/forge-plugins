#!/bin/bash
# forge-flow v3.1.6 UserPromptSubmit Hook
# 워크플로 진입 보장 + 상태 알림 + orphan 감지 + 에이전트팀 팀원 감지
#
# 등록: settings.local.json hooks.UserPromptSubmit
# stdin: (사용자 프롬프트 정보)
# stdout: { "additionalContext": "..." }

INPUT=$(cat)
SESSION_ID="${CLAUDE_SESSION_ID}"
STATE_FILE=".forge-flow/state/state-${SESSION_ID}.json"

# 에이전트팀 팀원 감지 (worktree 내부 + .forge-flow/ 부재)
GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null)
if [ -n "$GIT_COMMON_DIR" ] && [ "$GIT_COMMON_DIR" != ".git" ] && [ ! -d ".forge-flow" ]; then
  echo '{"additionalContext": "[TEAM] 팀원 세션. 할당된 태스크에 집중하세요. 담당 범위 외 파일 수정 금지."}'
  exit 0
fi

# jq 또는 python3 폴백
if command -v jq >/dev/null 2>&1; then
  _json_read() { jq -r "$1" "$2" 2>/dev/null; }
else
  _json_read() {
    local key="${1#.}"
    key="${key%% //*}"  # // default 제거
    python3 -c "import json; d=json.load(open('$2')); print(d.get('$key',''))" 2>/dev/null
  }
fi

# 0. 상태 파일 정리
# - completed 상태: 즉시 삭제 (+ 연결된 design 파일도 삭제)
if ls .forge-flow/state/state-*.json 1>/dev/null 2>&1; then
  for sf in .forge-flow/state/state-*.json; do
    [ -f "$sf" ] || continue
    SF_PHASE=$(_json_read '.phase' "$sf")
    if [ "$SF_PHASE" = "completed" ]; then
      SF_DESIGN=$(_json_read '.design_file' "$sf")
      [ -n "$SF_DESIGN" ] && [ -f "$SF_DESIGN" ] && rm -f "$SF_DESIGN"
      rm -f "$sf"
    fi
  done
fi
# - 7일 이상 경과: 안전망 삭제
find .forge-flow/state/ -name "state-*.json" -mtime +7 -delete 2>/dev/null

# 1. 기존 세션 — 상태 파일 기반 컨텍스트 주입
if [ -f "$STATE_FILE" ]; then
  PHASE=$(_json_read '.phase' "$STATE_FILE")
  DESIGN_FILE=$(_json_read '.design_file' "$STATE_FILE")
  SCALE=$(_json_read '.scale' "$STATE_FILE")
  [ -z "$DESIGN_FILE" ] && DESIGN_FILE="없음"
  [ -z "$SCALE" ] && SCALE="미정"

  case "$PHASE" in
    clarifying)
      echo "{\"additionalContext\": \"[WORKFLOW] 요구사항 명확화 중. design: $DESIGN_FILE\"}" ;;
    reviewing-req)
      echo "{\"additionalContext\": \"[WORKFLOW] 요구사항 검수 중. design: $DESIGN_FILE\"}" ;;
    planning)
      echo "{\"additionalContext\": \"[WORKFLOW] 설계 중. design: $DESIGN_FILE\"}" ;;
    reviewing-plan)
      echo "{\"additionalContext\": \"[WORKFLOW] 설계 검수 중. design: $DESIGN_FILE\"}" ;;
    implementing)
      echo "{\"additionalContext\": \"[WORKFLOW] 구현 중 (규모: $SCALE). 완료 시 /forge-flow:verify 필수. design: $DESIGN_FILE\"}" ;;
    verifying)
      echo "{\"additionalContext\": \"[WORKFLOW] 검수 진행 중. design: $DESIGN_FILE\"}" ;;
    verified)
      echo "{\"additionalContext\": \"[WORKFLOW] 검수 완료. 커밋 가능. design: $DESIGN_FILE\"}" ;;
    completed)
      echo "{\"additionalContext\": \"[WORKFLOW] 작업 완료.\"}" ;;
    *)
      echo "{\"additionalContext\": \"[WORKFLOW] 현재 단계: $PHASE. design: $DESIGN_FILE\"}" ;;
  esac
  exit 0
fi

# 2. 새 세션이지만 .forge-flow/design/ 파일 존재 — orphan 감지
if ls .forge-flow/design/*.md 1>/dev/null 2>&1; then
  ORPHANS=""
  for f in .forge-flow/design/*.md; do
    BASENAME=$(basename "$f")
    # 정확한 파일명 매칭 (부분 문자열 오탐 방지)
    REFERENCED=$(grep -rl "\".forge-flow/design/${BASENAME}\"" .forge-flow/state/state-*.json 2>/dev/null)
    if [ -z "$REFERENCED" ]; then
      ORPHANS="$ORPHANS ${BASENAME}"
    fi
  done

  if [ -n "$ORPHANS" ]; then
    # orphan design 파일 자동 정리
    for orphan in $ORPHANS; do
      rm -f ".forge-flow/design/${orphan}"
    done
    echo "{\"additionalContext\": \"[WORKFLOW] 이전 작업의 orphan 파일 정리됨:$ORPHANS. 새 작업은 /forge-flow:clarify로 시작하세요.\"}"
  else
    echo "{\"additionalContext\": \"[WORKFLOW] 새 작업을 시작하려면 /forge-flow:clarify로 요구사항을 먼저 명확히 하세요.\"}"
  fi
  exit 0
fi

# 3. 완전히 새로운 세션 — 워크플로 진입 안내
echo '{"additionalContext": "[WORKFLOW] 새 작업을 시작하려면 /forge-flow:clarify로 요구사항을 먼저 명확히 하세요."}'
exit 0
