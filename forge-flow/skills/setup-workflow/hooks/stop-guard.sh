#!/bin/bash
# forge-flow v3.4.0 Stop Hook (command 타입)
# 작업(Task) 기반 — 워크플로 미완료 시 종료 차단 + circuit breaker + 에이전트팀 팀원 바이패스
#
# 등록: ~/.claude/settings.json hooks.Stop (글로벌)
# stdin: { "stop_hook_active": bool, "last_assistant_message": "..." }
# stdout: { "decision": "block", "reason": "..." } 또는 빈 출력(허용)

INPUT=$(cat)
SESSION_ID="${CLAUDE_SESSION_ID}"

# forge-flow 미설치 프로젝트에서는 즉시 종료 (글로벌 훅 안전 가드)
[ -d ".forge-flow" ] || exit 0

# 에이전트팀 팀원은 리더가 생명주기 관리 → 즉시 통과
GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null)
if [ -n "$GIT_COMMON_DIR" ] && [ "$GIT_COMMON_DIR" != ".git" ] && [ ! -d ".forge-flow" ]; then
  exit 0
fi

# jq 사용 가능 여부 확인 → 없으면 python3 폴백
if command -v jq >/dev/null 2>&1; then
  _json_read() { jq -r "$1" "$2" 2>/dev/null; }
  _json_set_int() { jq --argjson v "$3" ".$2 = \$v" "$1" > "$1.tmp" && mv "$1.tmp" "$1"; }
else
  _json_read() {
    local key="${1#.}"
    key="${key%% //*}"
    python3 -c "import json; d=json.load(open('$2')); print(d.get('$key',''))" 2>/dev/null
  }
  _json_set_int() { python3 -c "
import json
with open('$1') as f: d=json.load(f)
d['$2']=$3
with open('$1','w') as f: json.dump(d,f,ensure_ascii=False)
" 2>/dev/null; }
fi

# 1. 현재 세션에 바인딩된 작업 탐색
STATE_FILE=""
if ls .forge-flow/state/*.json 1>/dev/null 2>&1; then
  for sf in .forge-flow/state/*.json; do
    [ -f "$sf" ] || continue
    SF_SID=$(_json_read '.session_id' "$sf")
    if [ "$SF_SID" = "$SESSION_ID" ]; then
      STATE_FILE="$sf"
      break
    fi
  done
fi

# 2. 바인딩된 작업 없으면 → 워크플로 밖, 통과
if [ -z "$STATE_FILE" ]; then
  exit 0
fi

PHASE=$(_json_read '.phase' "$STATE_FILE")

# 3. 이미 검수 완료면 → 즉시 통과
# 설계 의도: verify/test PASS 이후(verified, tested)와 마무리 중(completing, completed)만 통과 허용.
# awaiting_manual_result: 사용자가 직접 테스트 실행 후 돌아와야 하므로 세션 종료 허용.
# clarifying~implementing 등 워크플로 진행 중인 모든 단계는 차단하여 미완료 종료 방지.
if [ "$PHASE" = "verified" ] || [ "$PHASE" = "tested" ] || [ "$PHASE" = "completing" ] || [ "$PHASE" = "completed" ] || [ "$PHASE" = "awaiting_manual_result" ]; then
  exit 0
fi

# 4. Circuit breaker — stop_count 기반
STOP_COUNT=$(_json_read '.stop_count // 0' "$STATE_FILE")
STOP_COUNT=$((STOP_COUNT + 1))

# stop_count 갱신
_json_set_int "$STATE_FILE" "stop_count" "$STOP_COUNT"

if [ "$STOP_COUNT" -ge 3 ]; then
  # 연속 3회 차단 → 강제 통과 (무한 루프 방지)
  _json_set_int "$STATE_FILE" "stop_count" 0
  exit 0
fi

# 5. 미완료 → 차단
DESIGN_FILE=$(_json_read '.design_file // "없음"' "$STATE_FILE")
TASK_ID=$(_json_read '.task_id // "없음"' "$STATE_FILE")
echo "{\"decision\": \"block\", \"reason\": \"워크플로 미완료 (작업: ${TASK_ID}, phase: ${PHASE}). design: ${DESIGN_FILE}. /forge-flow:verify 합격 후 종료하세요.\"}"
exit 0
