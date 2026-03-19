#!/bin/bash
# forge-flow v3.2.0 Stop Hook (command 타입)
# 워크플로 미완료 시 종료 차단 + circuit breaker + 에이전트팀 팀원 바이패스
#
# 등록: settings.local.json hooks.Stop
# stdin: { "stop_hook_active": bool, "last_assistant_message": "..." }
# stdout: { "decision": "block", "reason": "..." } 또는 빈 출력(허용)

INPUT=$(cat)
SESSION_ID="${CLAUDE_SESSION_ID}"
STATE_FILE=".forge-flow/state/state-${SESSION_ID}.json"

# 에이전트팀 팀원은 리더가 생명주기 관리 → 즉시 통과
GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null)
if [ -n "$GIT_COMMON_DIR" ] && [ "$GIT_COMMON_DIR" != ".git" ] && [ ! -d ".forge-flow" ]; then
  exit 0
fi

# 1. 상태 파일 없으면 → 워크플로 밖, 통과
if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

# jq 사용 가능 여부 확인 → 없으면 python3 폴백
if command -v jq >/dev/null 2>&1; then
  _json_read() { jq -r "$1" "$2" 2>/dev/null; }
  _json_read_stdin() { printf '%s' "$1" | jq -r "$2" 2>/dev/null; }
  _json_set_int() { jq --argjson v "$3" ".$2 = \$v" "$1" > "$1.tmp" && mv "$1.tmp" "$1"; }
else
  _json_read() { python3 -c "import json; print(json.load(open('$2')).get('${1#.}',''))" 2>/dev/null; }
  _json_read_stdin() { python3 -c "import json; print(json.loads('''$1''').get('${2#.}',''))" 2>/dev/null; }
  _json_set_int() { python3 -c "
import json
with open('$1') as f: d=json.load(f)
d['$2']=$3
with open('$1','w') as f: json.dump(d,f,ensure_ascii=False)
" 2>/dev/null; }
fi

PHASE=$(_json_read '.phase' "$STATE_FILE")

# 2. 이미 검수 완료면 → 즉시 통과
if [ "$PHASE" = "verified" ] || [ "$PHASE" = "tested" ] || [ "$PHASE" = "completing" ] || [ "$PHASE" = "completed" ]; then
  exit 0
fi

# 3. Circuit breaker — stop_count 기반 (stop_hook_active 미제공 시에도 동작)
STOP_COUNT=$(_json_read '.stop_count // 0' "$STATE_FILE")
STOP_COUNT=$((STOP_COUNT + 1))

# stop_count 갱신
_json_set_int "$STATE_FILE" "stop_count" "$STOP_COUNT"

if [ "$STOP_COUNT" -ge 3 ]; then
  # 연속 3회 차단 → 강제 통과 (무한 루프 방지)
  _json_set_int "$STATE_FILE" "stop_count" 0
  exit 0
fi

# 4. 미완료 → 차단
DESIGN_FILE=$(_json_read '.design_file // "없음"' "$STATE_FILE")
echo "{\"decision\": \"block\", \"reason\": \"워크플로 미완료 (phase: ${PHASE}). design: ${DESIGN_FILE}. /forge-flow:verify 합격 후 종료하세요.\"}"
exit 0
