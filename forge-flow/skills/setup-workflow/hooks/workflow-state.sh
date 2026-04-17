#!/bin/bash
# forge-flow v3.4.0 UserPromptSubmit Hook
# 작업(Task) 기반 상태 관리 + 워크플로 진입 보장 + orphan 감지 + 에이전트팀 팀원 감지
#
# 등록: ~/.claude/settings.json hooks.UserPromptSubmit (글로벌)
# stdin: (사용자 프롬프트 정보)
# stdout: { "additionalContext": "..." }

trap '' PIPE  # Claude Code가 파이프를 일찍 닫아도 SIGPIPE로 비정상 종료 방지

INPUT=$(cat)
SESSION_ID="${CLAUDE_SESSION_ID}"

# forge-flow 미설치 프로젝트에서는 즉시 종료 (글로벌 훅 안전 가드)
[ -d ".forge-flow" ] || exit 0

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
    key="${key%% //*}"
    python3 -c "
import json, functools
d=json.load(open('$2'))
keys='$key'.split('.')
val=functools.reduce(lambda o,k: o.get(k,'') if isinstance(o,dict) else '', keys, d)
print(val if val != '' else '')
" 2>/dev/null
  }
fi

# 0. 하위호환: 구버전 state-*.json → {task_id}.json 마이그레이션
if ls .forge-flow/state/state-*.json 1>/dev/null 2>&1; then
  for sf in .forge-flow/state/state-*.json; do
    [ -f "$sf" ] || continue
    SF_DESIGN=$(_json_read '.design_file' "$sf")
    if [ -n "$SF_DESIGN" ] && [ "$SF_DESIGN" != "null" ]; then
      TASK_ID=$(basename "$SF_DESIGN" .md)
      NEW_SF=".forge-flow/state/${TASK_ID}.json"
      if [ ! -f "$NEW_SF" ]; then
        if command -v jq >/dev/null 2>&1; then
          jq --arg tid "$TASK_ID" '. + {task_id: $tid}' "$sf" > "$NEW_SF" 2>/dev/null
        else
          python3 -c "
import json
with open('$sf') as f: d=json.load(f)
d['task_id']='$TASK_ID'
with open('$NEW_SF','w') as f: json.dump(d,f,ensure_ascii=False)
" 2>/dev/null
        fi
        # 새 파일이 정상 생성된 경우에만 원본 삭제
        if [ -f "$NEW_SF" ]; then
          rm -f "$sf"
        fi
      else
        rm -f "$sf"
      fi
    else
      rm -f "$sf"
    fi
  done
fi

# 1. 상태 파일 정리
# - completed 상태: 즉시 삭제 (+ 연결된 design 파일은 keep_design 필드에 따라 처리)
if ls .forge-flow/state/*.json 1>/dev/null 2>&1; then
  for sf in .forge-flow/state/*.json; do
    [ -f "$sf" ] || continue
    SF_PHASE=$(_json_read '.phase' "$sf")
    if [ "$SF_PHASE" = "completed" ]; then
      SF_KEEP=$(_json_read '.keep_design' "$sf")
      if [ "$SF_KEEP" != "true" ]; then
        SF_DESIGN=$(_json_read '.design_file' "$sf")
        [ -n "$SF_DESIGN" ] && [ -f "$SF_DESIGN" ] && rm -f "$SF_DESIGN"
      fi
      rm -f "$sf"
    fi
  done
fi
# - 30일 이상 경과: 안전망 삭제
find .forge-flow/state/ -name "*.json" -not -name "state-*.json" -mtime +30 -delete 2>/dev/null

# 2. 현재 세션에 바인딩된 작업 탐색
BOUND_STATE=""
if ls .forge-flow/state/*.json 1>/dev/null 2>&1; then
  for sf in .forge-flow/state/*.json; do
    [ -f "$sf" ] || continue
    SF_SID=$(_json_read '.session_id' "$sf")
    if [ "$SF_SID" = "$SESSION_ID" ]; then
      BOUND_STATE="$sf"
      break
    fi
  done
fi

# 3. 바인딩된 작업 있음 → 상태 안내
if [ -n "$BOUND_STATE" ]; then
  PHASE=$(_json_read '.phase' "$BOUND_STATE")
  DESIGN_FILE=$(_json_read '.design_file' "$BOUND_STATE")
  SCALE=$(_json_read '.scale' "$BOUND_STATE")
  TASK_ID=$(_json_read '.task_id' "$BOUND_STATE")
  WORK_DIR=$(_json_read '.work_dir' "$BOUND_STATE")
  [ -z "$DESIGN_FILE" ] && DESIGN_FILE="없음"
  [ -z "$SCALE" ] && SCALE="미정"
  [ -z "$TASK_ID" ] && TASK_ID="(알 수 없음)"

  # work_dir 컨텍스트 조립 (work_dir가 있고 null/빈문자열이 아닐 때만)
  WORK_DIR_CTX=""
  if [ -n "$WORK_DIR" ] && [ "$WORK_DIR" != "null" ]; then
    WORK_DIR_CTX=" [WORKTREE] 작업 디렉토리: ${WORK_DIR}. 파일 읽기/수정은 ${WORK_DIR}/ 경로 사용. git 명령: git -C ${WORK_DIR}."
  fi

  case "$PHASE" in
    clarifying)
      echo "{\"additionalContext\": \"[WORKFLOW:${TASK_ID}] 요구사항 명확화 중.${WORK_DIR_CTX} design: $DESIGN_FILE [COMPACT] 현재 단계에서는 /compact를 피하세요 — 사용자와의 대화 맥락이 아직 design 문서에 확정되지 않았습니다.\"}" ;;
    reviewing-req)
      echo "{\"additionalContext\": \"[WORKFLOW:${TASK_ID}] 요구사항 검수 중.${WORK_DIR_CTX} design: $DESIGN_FILE [COMPACT] 현재 단계에서는 /compact를 피하세요 — 검수 피드백 반영 맥락이 손실될 수 있습니다.\"}" ;;
    req-reviewed)
      echo "{\"additionalContext\": \"[WORKFLOW:${TASK_ID}] 요구사항 검수 완료.${WORK_DIR_CTX} /forge-flow:plan으로 구현 계획을 수립하세요. design: $DESIGN_FILE [COMPACT] 컨텍스트가 길어졌다면 plan 전 /compact를 권장합니다.\"}" ;;
    planning)
      echo "{\"additionalContext\": \"[WORKFLOW:${TASK_ID}] 설계 중.${WORK_DIR_CTX} design: $DESIGN_FILE [COMPACT] 컨텍스트가 길어졌다면 plan 완료 후 /compact를 권장합니다.\"}" ;;
    reviewing-plan)
      echo "{\"additionalContext\": \"[WORKFLOW:${TASK_ID}] 설계 검수 중.${WORK_DIR_CTX} design: $DESIGN_FILE [COMPACT] 현재 단계에서는 /compact를 피하세요 — 검수 피드백 반영 맥락이 손실될 수 있습니다.\"}" ;;
    implementing)
      VERIFY_RW=$(_json_read '.rework_counts.verify' "$BOUND_STATE")
      TEST_RW=$(_json_read '.rework_counts.test' "$BOUND_STATE")
      [ -z "$VERIFY_RW" ] && VERIFY_RW=0
      [ -z "$TEST_RW" ] && TEST_RW=0
      TOTAL_RW=$((VERIFY_RW + TEST_RW))
      if [ "$TOTAL_RW" -gt 0 ] 2>/dev/null; then
        RW_DETAIL=""
        [ "$VERIFY_RW" -gt 0 ] 2>/dev/null && RW_DETAIL="verify:${VERIFY_RW}"
        [ "$TEST_RW" -gt 0 ] 2>/dev/null && { [ -n "$RW_DETAIL" ] && RW_DETAIL="${RW_DETAIL}, "; RW_DETAIL="${RW_DETAIL}test:${TEST_RW}"; }
        echo "{\"additionalContext\": \"[WORKFLOW:${TASK_ID}] 구현 중 (규모: $SCALE, REWORK ${RW_DETAIL}).${WORK_DIR_CTX} debug-gate 루트코즈 가설 기반으로 수정하세요. design 문서의 '따를 기존 패턴' 참조. 완료 시 /forge-flow:verify 필수. design: $DESIGN_FILE [COMPACT] 구현 중간에는 /compact를 피하세요.\"}"
      else
        echo "{\"additionalContext\": \"[WORKFLOW:${TASK_ID}] 구현 중 (규모: $SCALE).${WORK_DIR_CTX} design 문서의 '따를 기존 패턴' 섹션을 반드시 참조하여 기존 코드 패턴과 일관되게 구현하세요. 완료 시 /forge-flow:verify 필수. design: $DESIGN_FILE [COMPACT] 구현 시작 전이라면 /compact 권장. 구현 중간에는 피하세요.\"}"
      fi ;;
    verifying)
      echo "{\"additionalContext\": \"[WORKFLOW:${TASK_ID}] 검수 진행 중.${WORK_DIR_CTX} design: $DESIGN_FILE [COMPACT] 현재 단계에서는 /compact를 피하세요 — 검수 결과 맥락이 손실될 수 있습니다.\"}" ;;
    verified)
      echo "{\"additionalContext\": \"[WORKFLOW:${TASK_ID}] 검수 완료.${WORK_DIR_CTX} /forge-flow:complete로 작업을 마무리하세요. design: $DESIGN_FILE [COMPACT] 컨텍스트가 길어졌다면 /compact 후 마무리해도 안전합니다.\"}" ;;
    testing)
      echo "{\"additionalContext\": \"[WORKFLOW:${TASK_ID}] 실행 테스트 중.${WORK_DIR_CTX} design: $DESIGN_FILE [COMPACT] 현재 단계에서는 /compact를 피하세요 — 테스트 결과 맥락이 손실될 수 있습니다.\"}" ;;
    awaiting_manual_result)
      echo "{\"additionalContext\": \"[WORKFLOW:${TASK_ID}] 수동 테스트 대기 중.${WORK_DIR_CTX} 테스트를 직접 실행하고 결과를 입력하세요. 완료 시 /forge-flow:test 재호출. design: $DESIGN_FILE\"}" ;;
    tested)
      echo "{\"additionalContext\": \"[WORKFLOW:${TASK_ID}] 테스트 완료.${WORK_DIR_CTX} /forge-flow:complete로 작업을 마무리하세요. design: $DESIGN_FILE [COMPACT] 컨텍스트가 길어졌다면 /compact 후 마무리해도 안전합니다.\"}" ;;
    completing)
      echo "{\"additionalContext\": \"[WORKFLOW:${TASK_ID}] 작업 마무리 중.${WORK_DIR_CTX} design: $DESIGN_FILE\"}" ;;
    completed)
      echo "{\"additionalContext\": \"[WORKFLOW:${TASK_ID}] 작업 완료.\"}" ;;
    *)
      echo "{\"additionalContext\": \"[WORKFLOW:${TASK_ID}] 현재 단계: $PHASE. design: $DESIGN_FILE\"}" ;;
  esac
  exit 0
fi

# 4. 바인딩된 작업 없음 — 미완료 작업 탐색 (다른 세션에서 남은 것)
ACTIVE_TASKS=""
ACTIVE_COUNT=0
if ls .forge-flow/state/*.json 1>/dev/null 2>&1; then
  for sf in .forge-flow/state/*.json; do
    [ -f "$sf" ] || continue
    SF_PHASE=$(_json_read '.phase' "$sf")
    SF_TASK=$(_json_read '.task_id' "$sf")
    if [ "$SF_PHASE" != "completed" ] && [ -n "$SF_TASK" ]; then
      ACTIVE_TASKS="$ACTIVE_TASKS ${SF_TASK}(${SF_PHASE})"
      ACTIVE_COUNT=$((ACTIVE_COUNT + 1))
    fi
  done
fi

if [ "$ACTIVE_COUNT" -gt 0 ]; then
  echo "{\"additionalContext\": \"[WORKFLOW] 미완료 작업 ${ACTIVE_COUNT}건:${ACTIVE_TASKS}. /forge-flow:clarify로 이어서 진행하거나 새 작업을 시작하세요.\"}"
  exit 0
fi

# 5. orphan design 파일 감지 (state 없는 design) — 알림만, 자동 삭제 안 함
if ls .forge-flow/design/*.md 1>/dev/null 2>&1; then
  ORPHANS=""
  for f in .forge-flow/design/*.md; do
    BASENAME=$(basename "$f" .md)
    if [ ! -f ".forge-flow/state/${BASENAME}.json" ]; then
      ORPHANS="$ORPHANS ${BASENAME}"
    fi
  done

  if [ -n "$ORPHANS" ]; then
    echo "{\"additionalContext\": \"[WORKFLOW] 상태 파일 없는 design 파일 발견:${ORPHANS}. /forge-flow:clarify로 이어서 진행하거나 새 작업을 시작하세요.\"}"
    exit 0
  fi
fi

# 6. 완전히 새로운 세션 — 워크플로 진입 안내
echo '{"additionalContext": "[WORKFLOW] 새 작업을 시작하려면 /forge-flow:clarify로 요구사항을 먼저 명확히 하세요."}'
exit 0
