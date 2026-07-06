#!/bin/bash
# forge-flow v3.4.0 PreToolUse Hook — 위험 작업 차단
#
# 등록: ~/.claude/settings.json hooks.PreToolUse (글로벌, matcher: "Bash")
# stdin: { "tool_name": "Bash", "tool_input": { "command": "..." } }
# stdout: { "hookSpecificOutput": {"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."} } 또는 빈 출력(허용)
# (CC 2.1+ 는 bare 포맷 무시 — hookSpecificOutput 래퍼 필수)

trap '' PIPE  # Claude Code가 파이프를 일찍 닫아도 SIGPIPE로 비정상 종료 방지

INPUT=$(cat)

# forge-flow 미설치 프로젝트에서는 즉시 종료 (글로벌 훅 안전 가드)
[ -d ".forge-flow" ] || exit 0

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
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"위험 명령 감지: 사용자 확인이 필요합니다."}}'
  exit 0
fi

# 민감 파일 "수정" 명령 검사 — 쓰기 연산의 '대상' 파일명이 민감할 때만 차단.
#   차단:   echo ... >> .env / cat > credentials.json / tee -a secret.key / sed -i ... token.txt
#   비차단: ssh -i key.pem host 'cmd'  (키를 '읽기'만),  heredoc 본문에 경로만 등장 (대상은 비민감)
# 리다이렉트(>,>>) 대상 또는 tee/sed -i 인자 파일명이 민감 토큰을 포함할 때만 deny.
SENS='(\.env|\.key|\.pem|credentials|secret|token)'
if printf '%s' "$CMD" | grep -qiE ">>?[[:space:]]*[\"']?[^ \"'|;&]*${SENS}" \
   || printf '%s' "$CMD" | grep -qiE "tee([[:space:]]+-a)?[[:space:]]+[\"']?[^ \"'|;&]*${SENS}" \
   || printf '%s' "$CMD" | grep -qiE "sed[[:space:]]+-i[^|;&]*${SENS}"; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"민감 파일 수정 감지: 사용자 확인이 필요합니다."}}'
  exit 0
fi

exit 0
