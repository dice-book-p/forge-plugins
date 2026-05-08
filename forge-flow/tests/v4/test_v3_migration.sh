#!/usr/bin/env bash
# WU-4 검증: clarify SKILL.md에 v3 마이그레이션 로직이 명시되어 있다.
# RED: 마이그레이션 섹션 부재 → FAIL.
# GREEN: clarify SKILL.md에 ## v3 → v4 마이그레이션 섹션 + 5개 검증 케이스 명시 → PASS.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLARIFY="$SCRIPT_DIR/../../skills/clarify/SKILL.md"

fail=0

echo "[1/9] 마이그레이션 섹션 존재"
if ! grep -qE '^## v3.*v4 마이그레이션' "$CLARIFY"; then
  echo "  FAIL: '## v3 → v4 마이그레이션' 섹션 부재"
  fail=1
fi

echo "[2/9] settings.json 정밀 제거 정규식 명시"
if ! grep -qE 'forge-flow.*-hooks.*workflow-state.*stop-guard.*dangerous-cmd-guard' "$CLARIFY"; then
  echo "  FAIL: settings.json 매칭 정규식 명시 없음"
  fail=1
fi

echo "[3/9] v4 캐시 보존 (3.x.x만 대상) 명시"
if ! grep -qE '3\.x\.x|\^\[0-3\]' "$CLARIFY"; then
  echo "  FAIL: v4 캐시(4.x.x) 보존 필터 명시 없음"
  fail=1
fi

echo "[4/9] CLAUDE.md 편집 실패 폴백 명시"
if ! grep -qE 'CLAUDE\.md.*편집 실패|편집 실패.*settings\.json' "$CLARIFY"; then
  echo "  FAIL: CLAUDE.md 편집 실패 폴백 명시 없음"
  fail=1
fi

echo "[5/9] settings.json JSON 파싱 실패 폴백 명시"
if ! grep -qE 'JSON 파싱 실패' "$CLARIFY"; then
  echo "  FAIL: settings.json JSON 파싱 실패 폴백 명시 없음"
  fail=1
fi

echo "[6/9] 마이그레이션 마커 (~/.claude/forge-flow-migrated.v4) 명시"
if ! grep -qE 'forge-flow-migrated\.v4' "$CLARIFY"; then
  echo "  FAIL: 마이그레이션 마커 경로 명시 없음"
  fail=1
fi

echo "[7/9] description 트리거어 0건"
DESC_LINE=$(awk '/^description:/{print; exit}' "$CLARIFY")
if echo "$DESC_LINE" | grep -qE "추가|만들어|구현|변경|리팩토링"; then
  echo "  FAIL: description에 자연어 트리거어 잔존: $DESC_LINE"
  fail=1
fi

echo "[8/9] description 사용법 힌트 1줄 포함"
if ! echo "$DESC_LINE" | grep -qE '/forge-flow:clarify'; then
  echo "  FAIL: description에 사용법 힌트 부재"
  fail=1
fi

echo "[9/9] 백업 파일명 timestamp+suffix 패턴 명시"
if ! grep -qE 'timestamp|ms.*rand|bak\.\{ms\}' "$CLARIFY"; then
  echo "  FAIL: 백업 파일명 패턴 명시 없음"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "PASS"
  exit 0
else
  exit 1
fi
