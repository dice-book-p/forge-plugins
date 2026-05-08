#!/usr/bin/env bash
# WU-5 검증: plan SKILL.md TDD 토글 + verify SKILL.md RED 게이트.
# RED: 미수정 plan/verify에 TDD 통합 부재 → FAIL.
# GREEN: plan에 단위테스트-TDD + 토글, verify에 RED 게이트 추가 → PASS.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS="$SCRIPT_DIR/../../skills"

fail=0

echo "[1/6] plan SKILL.md 검증방식에 단위테스트-TDD 추가"
if ! grep -qE '단위테스트-TDD' "$SKILLS/plan/SKILL.md"; then
  echo "  FAIL: plan/SKILL.md에 단위테스트-TDD 옵션 부재"
  fail=1
fi

echo "[2/6] plan SKILL.md TDD on/off 토글 명시"
if ! grep -qE 'TDD.*(on|off|토글)' "$SKILLS/plan/SKILL.md"; then
  echo "  FAIL: plan/SKILL.md에 TDD 토글 명시 부재"
  fail=1
fi

echo "[3/6] plan SKILL.md 인프라 unit 자동 분류(스킵) 명시"
if ! grep -qE '인프라.*unit.*스킵|스킵.*인프라' "$SKILLS/plan/SKILL.md"; then
  echo "  FAIL: plan/SKILL.md에 인프라 unit 자동 분류 명시 부재"
  fail=1
fi

echo "[4/6] verify SKILL.md 단위테스트-TDD RED 게이트 명시"
if ! grep -qE '단위테스트-TDD.*RED|RED.*기록.*차단|RED.*부재.*차단' "$SKILLS/verify/SKILL.md"; then
  echo "  FAIL: verify/SKILL.md에 단위테스트-TDD RED 게이트 명시 부재"
  fail=1
fi

echo "[5/6] verify SKILL.md 게이트 엄격도(단위테스트-TDD만 차단) 명시"
if ! grep -qE '단위테스트-TDD.*만.*차단|차단.*단위테스트-TDD.*만' "$SKILLS/verify/SKILL.md"; then
  echo "  FAIL: verify/SKILL.md에 게이트 엄격도 명시 부재"
  fail=1
fi

echo "[6/6] plan SKILL.md RED-GREEN-REFACTOR 절차 명시"
if ! grep -qE 'RED.*GREEN.*REFACTOR|RED-GREEN-REFACTOR' "$SKILLS/plan/SKILL.md"; then
  echo "  FAIL: plan/SKILL.md에 RED-GREEN-REFACTOR 절차 명시 부재"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "PASS"
  exit 0
else
  exit 1
fi
