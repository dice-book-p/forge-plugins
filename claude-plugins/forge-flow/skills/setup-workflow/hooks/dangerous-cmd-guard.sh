#!/bin/bash
# forge-flow v3 PreToolUse Hook — 위험 작업 차단
#
# 등록: settings.local.json hooks.PreToolUse (matcher: "Bash")
# stdin: { "tool_name": "Bash", "tool_input": { "command": "..." } }
# stdout: { "permissionDecision": "deny", "reason": "..." } 또는 빈 출력(허용)

INPUT=$(cat)

# jq 또는 python3 폴백
if command -v jq >/dev/null 2>&1; then
  TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)
  CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)
else
  TOOL_NAME=$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('tool_name',''))" <<< "$INPUT" 2>/dev/null)
  CMD=$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('tool_input',{}).get('command',''))" <<< "$INPUT" 2>/dev/null)
fi

# Bash 명령만 검사
if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

# 위험 명령 패턴 검사 (변형 패턴 포함)
if printf '%s' "$CMD" | grep -qiE '(rm\s+(-[a-z]*r[a-z]*\s+-[a-z]*f|--recursive.*--force|-rf|-fr)|DROP\s+TABLE|git\s+push\s+.*--force|git\s+reset\s+--hard|kubectl\s+delete|truncate\s+table)'; then
  echo '{"permissionDecision": "deny", "reason": "위험 명령 감지: 사용자 확인이 필요합니다."}'
  exit 0
fi

# 민감 파일 수정 명령 검사
if printf '%s' "$CMD" | grep -qE '(\.env|\.key|\.pem|credentials|secret|token)' && printf '%s' "$CMD" | grep -qE '(cat >|echo.*>|sed -i|tee|>>)'; then
  echo '{"permissionDecision": "deny", "reason": "민감 파일 수정 감지: 사용자 확인이 필요합니다."}'
  exit 0
fi

exit 0
