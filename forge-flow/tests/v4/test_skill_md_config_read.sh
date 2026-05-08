#!/usr/bin/env bash
# WU-3 검증: 5개 SKILL.md가 CLAUDE.md ## 빌드 명령 / ## 변경 전파 체인을 직접 Read하지 않는다.
# RED 단계: 미수정 상태에서 실행하면 매칭이 발견되어 FAIL해야 한다.
# GREEN 단계: 5개 SKILL.md 모두 .forge-flow/config.json Read로 교체된 후 PASS.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$SCRIPT_DIR/../../skills"

PATTERNS=(
  'CLAUDE\.md.*## 빌드 명령'
  'CLAUDE\.md.*## 변경 전파 체인'
)
TARGETS=(
  "$SKILLS_DIR/build-check/SKILL.md"
  "$SKILLS_DIR/fe-check/SKILL.md"
  "$SKILLS_DIR/clarify/SKILL.md"
  "$SKILLS_DIR/plan/SKILL.md"
  "$SKILLS_DIR/verify/SKILL.md"
)

fail=0
echo "[1/2] CLAUDE.md 직접 Read 패턴 부재 검증"
for f in "${TARGETS[@]}"; do
  if [ ! -f "$f" ]; then
    echo "  SKIP: $f (파일 없음)"
    continue
  fi
  for p in "${PATTERNS[@]}"; do
    matches=$(grep -nE "$p" "$f" || true)
    if [ -n "$matches" ]; then
      echo "  FAIL: $f"
      echo "$matches" | sed 's/^/    /'
      fail=1
    fi
  done
done

echo "[2/2] .forge-flow/config.json 참조 존재 검증"
for f in "${TARGETS[@]}"; do
  if [ ! -f "$f" ]; then continue; fi
  if ! grep -qE '\.forge-flow/config\.json' "$f"; then
    echo "  FAIL: $f — .forge-flow/config.json 참조 없음"
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "PASS"
  exit 0
else
  exit 1
fi
