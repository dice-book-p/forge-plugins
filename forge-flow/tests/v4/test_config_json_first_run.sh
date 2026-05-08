#!/usr/bin/env bash
# WU-3 검증: clarify SKILL.md에 .forge-flow/config.json 부재 감지 + 작성 흐름이 명시되어 있다.
# RED 단계: 미수정 clarify에는 config.json 관련 로직 없음 → FAIL.
# GREEN 단계: clarify SKILL.md 보강 후 PASS.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLARIFY="$SCRIPT_DIR/../../skills/clarify/SKILL.md"

fail=0
echo "[1/4] clarify SKILL.md 존재 확인"
if [ ! -f "$CLARIFY" ]; then
  echo "  FAIL: $CLARIFY 부재"
  exit 1
fi

echo "[2/4] config.json 부재 감지 섹션 존재"
if ! grep -qE 'config\.json.*(부재|없|첫 실행|초기화)|첫 실행.*config\.json' "$CLARIFY"; then
  echo "  FAIL: config.json 부재 감지 로직 명시 없음"
  fail=1
fi

echo "[3/4] .forge-flow/config.json 경로 명시"
if ! grep -qE '\.forge-flow/config\.json' "$CLARIFY"; then
  echo "  FAIL: .forge-flow/config.json 경로 명시 없음"
  fail=1
fi

echo "[4/4] 컨피그 3필드(build_commands, branch_strategy, propagation_chain) 질문 명시"
for field in 'build_commands' 'branch_strategy' 'propagation_chain'; do
  if ! grep -qE "$field" "$CLARIFY"; then
    echo "  FAIL: '$field' 필드 명시 없음"
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "PASS"
  exit 0
else
  exit 1
fi
