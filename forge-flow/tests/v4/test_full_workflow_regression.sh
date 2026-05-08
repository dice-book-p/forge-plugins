#!/usr/bin/env bash
# WU-8 검증: v4 전체 회귀 시나리오 통합 검증.
# (1) 마이그레이션 흐름 SKILL.md 명세 완결성
# (2) config.json 부트스트랩 흐름 명세 완결성
# (3) review-req~complete 6개 SKILL.md description 자동 활성화 매커니즘 불변
# (4) AC-13 활성 작업 phase 정의 명시
# (5) 의존 데이터(state/design/rework-log) 보존 명시

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS="$SCRIPT_DIR/../../skills"
CLARIFY="$SKILLS/clarify/SKILL.md"

fail=0

echo "[1/8] 시나리오 ① v3 잔재 감지 (settings.json + CLAUDE.md + cache 3-way)"
for kw in 'settings\.json' 'CLAUDE\.md' '캐시'; do
  if ! grep -qE "$kw" "$CLARIFY"; then
    echo "  FAIL: 마이그레이션 감지 대상에 '$kw' 누락"
    fail=1
  fi
done

echo "[2/8] 시나리오 ② AskUserQuestion 동의 흐름 명시"
if ! grep -qE '동의|AskUserQuestion' "$CLARIFY"; then
  echo "  FAIL: 마이그레이션 동의 흐름 명시 부재"
  fail=1
fi

echo "[3/8] 시나리오 ③ 백업+정밀 제거 순서"
if ! grep -qE '백업.*우선|백업.*먼저|백업.*생성.*제거|백업.*정밀 제거' "$CLARIFY"; then
  echo "  FAIL: 백업→정밀제거 순서 명시 부재"
  fail=1
fi

echo "[4/8] 시나리오 ④ config.json 부재 감지 + 작성 흐름"
if ! grep -qE 'config\.json.*부재|부재.*config\.json|첫 실행' "$CLARIFY"; then
  echo "  FAIL: config.json 부재 감지 흐름 명시 부재"
  fail=1
fi

echo "[5/8] 6개 SKILL.md description 자동 활성화 매커니즘 불변"
EXPECTED_AUTO=(
  "review-req:design 파일 생성 직후 자동 활성화"
  "plan:review-req 통과 후 자동 활성화"
  "review-plan:plan에서 작성된"
  "verify:코드 변경 완료, 구현 완료 시 자동 트리거"
  "test:verify PASS 후 자동 트리거"
  "complete:test 통과 후 자동 트리거"
)
for entry in "${EXPECTED_AUTO[@]}"; do
  skill="${entry%%:*}"
  pattern="${entry#*:}"
  desc=$(awk '/^description:/{print; exit}' "$SKILLS/$skill/SKILL.md")
  if [ -z "$desc" ]; then
    echo "  FAIL: $skill SKILL.md description 라인 부재"
    fail=1
    continue
  fi
  if ! echo "$desc" | grep -qE "자동 (활성화|트리거)|$pattern"; then
    echo "  FAIL: $skill description에 자동 활성화 메커니즘 부재"
    echo "    실제: $desc"
    fail=1
  fi
done

echo "[6/8] AC-13 활성 작업 phase 정의 명시 (clarify 작업 탐색)"
if ! grep -qE 'completed|clarifying|phase' "$CLARIFY"; then
  echo "  FAIL: 활성 작업 phase 정의 명시 부재"
  fail=1
fi

echo "[7/8] 의존 데이터 보존 (.forge-flow/state/.../design/.../rework-log)"
for path in 'state' 'design' 'rework-log'; do
  if ! grep -qE "\.forge-flow/$path|$path" "$CLARIFY"; then
    echo "  FAIL: '.forge-flow/$path' 참조 부재"
    fail=1
  fi
done

echo "[8/8] 자동 트리거 약화 안내 1회 출력 명시"
if ! grep -qE '1회.*안내|완료 안내|마이그레이션 완료' "$CLARIFY"; then
  echo "  FAIL: 마이그레이션 완료 1회 안내 명시 부재"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "PASS"
  exit 0
else
  exit 1
fi
