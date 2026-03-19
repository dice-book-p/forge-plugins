---
name: setup-workflow
description: "forge-flow 워크플로를 프로젝트에 설치합니다."
---

# /forge-flow:setup-workflow  `v3.2.0`

프로젝트에 forge-flow 워크플로를 설치합니다.
단일 레포, 모노레포 모두 자동 감지하여 올바르게 설치합니다.

## ARGUMENTS

```
/forge-flow:setup-workflow           # 신규 설치 또는 업그레이드 자동 감지
/forge-flow:setup-workflow --update  # 변경된 항목만 감지 → 선택 적용
/forge-flow:setup-workflow --reset   # 전체 제거 → Q&A → 재설치
/forge-flow:setup-workflow --purge   # 전체 제거만 (확인 후 실행)
```

---

## 실행 흐름 개요

```
1단계: 프로젝트 상태 판별 (기존 vs 신규) + 구조 감지 (단일/모노레포)
2단계: 정보 수집 (자동 감지 + 확인 / Q&A)
3단계: 사용자 선택 (옵션)
4단계: 설치 실행
  4.1 CLAUDE.md 패치 (루트)
  4.2 hooks 등록 (루트, 상대 경로)
  4.3 디렉토리 생성 (루트)
  4.4 훅 스크립트 생성 (루트)
  4.5 서브프로젝트 훅 스크립트 복사 (모노레포)
  4.6 조건부 설정
  4.7 .gitignore 업데이트 (루트)
  4.8 훅 스크립트 git 추적 설정
5단계: 검증 + 결과 보고
```

---

## 1단계: 프로젝트 상태 판별

### 기존 vs 신규 판별

```
기존 프로젝트 판별 기준:
- package.json, build.gradle, pom.xml, Cargo.toml, go.mod, pyproject.toml 등 존재
- src/ 또는 lib/ 디렉토리 존재
- .git/ 존재

→ 하나라도 있으면: 기존 프로젝트 → 자동 감지 실행
→ 모두 없으면: 신규 프로젝트 → Q&A로 직행
```

### 구조 감지: 단일 레포 vs 모노레포

**모노레포 판별 기준**: CWD 하위에 독립 빌드 파일(`package.json`, `build.gradle`, `pom.xml`, `Cargo.toml`, `go.mod` 등)을 가진 서브디렉토리가 2개 이상 존재하면 모노레포로 판단.

```
탐색 방법:
1. find . -maxdepth 2 -name "package.json" -not -path "*/node_modules/*"
2. find . -maxdepth 2 -name "build.gradle" -o -name "pom.xml" -o -name "go.mod"
3. 결과가 ./package.json 하나뿐이면 단일 레포
4. 서브디렉토리에도 빌드 파일이 있으면 모노레포 → 서브프로젝트 목록 수집
```

**서브프로젝트 목록 확인**: 감지된 서브프로젝트를 사용자에게 확인 (빌드 명령 및 변경 전파용)
```
[모노레포 감지]
  서브프로젝트:
    - namdo_market/        (build.gradle)
    - namdo_market_fe/     (package.json)
    - namdo_market_bff/    (build.gradle)
    - namdo_market_auth/   (build.gradle)
  빌드 명령 및 변경 전파 체인에 반영합니다. 맞나요? [Y/n]
  제외할 서브프로젝트가 있으면 입력하세요 (없으면 Enter):
```

> `node_modules/`, `.git/`, `dist/`, `build/`, `out/` 등은 서브프로젝트에서 자동 제외

**프로젝트 루트 확인**:
- CWD에 빌드 파일이 없으면 하위 디렉토리 스캔
- 후보가 여러 개면 사용자에게 확인: "프로젝트 루트가 어디인가요?"
- 선택 결과를 CLAUDE.md에 기록

---

## 2단계: 정보 수집

### 수집 항목

| 항목 | 필요한 단계 | 기존 프로젝트 | 신규 프로젝트 |
|------|-----------|:----------:|:----------:|
| **빌드 명령** | verify, build-check | 자동 감지 + 확인 | Q&A (미정이면 스킵) |
| **테스트 명령** | verify | 자동 감지 + 확인 | Q&A (미정이면 스킵) |
| **프로젝트 구조** (모노레포/단일) | plan, verify | 자동 감지 | Q&A |
| **FE/BE 구분** | fe-check 활성화 | 자동 감지 | Q&A (계획 중인 스택) |
| **기준 브랜치** | plan (브랜치 분기) | 자동 감지 + 확인 | Q&A |
| **브랜치 네이밍 패턴** | plan (기능 브랜치) | 기존 패턴 분석, 불명확 시 Q&A | Q&A |
| **프로젝트 루트 경로** | 전체 | 빌드 파일 위치 추정 | Q&A |

**수집 불필요 (제거)**:
- 프로젝트 설명 → clarify가 매 작업마다 코드를 읽어 판단
- 역할 목록 → 에이전트팀 구성 시 동적 결정
- MCP 목록 → Claude가 자동 인식. 워크플로가 특정 MCP에 의존하면 안 됨

### 기존 프로젝트: 자동 감지 + 확인

프로젝트 파일을 직접 탐색하여 자동 감지합니다:
- **빌드 명령**: `package.json` scripts, `build.gradle`, `Makefile`, `Cargo.toml` 등에서 추출
- **테스트 명령**: `package.json` test script, `gradlew test`, `pytest`, `go test` 등 탐색
- **프로젝트 구조**: 하위 디렉토리에 독립 빌드 파일이 있으면 모노레포
- **FE/BE 구분**: `package.json`에 React/Vue/Next 등 의존성 존재 여부
- **기준 브랜치**: `git symbolic-ref refs/remotes/origin/HEAD` 또는 `main`/`develop` 탐색
- **브랜치 패턴**: `git branch -r`에서 `feature/*`, `feat/*` 등 공통 패턴 추출

감지 결과를 사용자에게 확인:
```
[자동 감지 결과]
  빌드 명령: ./gradlew build → 맞나요? [Y/n]
  테스트 명령: ./gradlew test → 맞나요? [Y/n]
  프로젝트 구조: 모노레포 (backend/, frontend/) → 맞나요? [Y/n]
  FE 프레임워크: React (package.json 감지) → 맞나요? [Y/n]
  기준 브랜치: main → 맞나요? [Y/n]
  브랜치 패턴: feature/* (기존 브랜치 분석) → 맞나요? [Y/n]

감지 실패 항목은 질문으로 수집합니다.
```

### 신규 프로젝트: Q&A 기반 수집

```
Q1. 사용할 기술 스택은? (예: Spring Boot + React, Next.js, Python FastAPI)
Q2. 빌드 명령은? (아직 미정이면 Enter로 스킵)
Q3. 테스트 명령은? (아직 미정이면 Enter로 스킵)
Q4. 기준 브랜치는? (예: main, develop) [기본: main]
Q5. 기능 브랜치 패턴은? (예: feature/*, feat/*, 없음) [기본: feature/]
```

> **신규 프로젝트 "미정" 항목**: 빌드/테스트 명령이 아직 결정 안 된 경우 스킵. 이후 `--update`로 업데이트.

---

## 3단계: 사용자 선택 (옵션)

```
에이전트팀 기능을 활성화할까요? (병렬 가능 시 동적 팀 구성) [y/N]
```

- **활성화 시**: settings.local.json에 환경변수 주입. plan에서 병렬 가능 시 동적 팀 구성, verify에서 관점별 검증 팀 구성
- **비활성화 시 (기본값)**: 단일 세션 워크플로. 서브에이전트 교차검증은 여전히 동작

---

## 4단계: 설치 실행

사용자 동의 후 실행합니다.

### 4.1 CLAUDE.md 패치 (루트만)

루트의 CLAUDE.md에만 워크플로 섹션 삽입.
이 플러그인의 `templates/claude-md-sections-v2.md` 템플릿을 기반으로 합니다.

> **모노레포도 루트에만**: Claude Code는 CWD에서 상위로 올라가며 CLAUDE.md를 모두 읽습니다. 서브프로젝트에서 Claude를 열어도 루트 CLAUDE.md가 자동 상속됩니다. 서브프로젝트별 CLAUDE.md 중복 불필요.

플레이스홀더 치환:
| 플레이스홀더 | 값 |
|------------|-----|
| `{BUILD_COMMANDS_TABLE}` | 수집된 빌드 명령 테이블 |
| `{CHANGE_PROPAGATION_TABLE}` | 모노레포 시 전파 체인, 단일 시 "없음" |
| `{BASE_BRANCH}` | 기준 브랜치 |
| `{BRANCH_PATTERN}` | 기능 브랜치 패턴 |
| `{AGENT_TEAMS_SECTION}` | 에이전트팀 활성화 시 섹션 삽입, 비활성 시 빈 문자열 |

### 4.2 hooks 등록

**훅은 세션 스코프이며, Claude 시작 시 CWD의 `.claude/settings.local.json`에서 한 번만 로드됩니다.** 훅 명령은 **상대 경로**(`bash .claude/hooks/...`)로 등록하며, Claude가 세션 중 서브프로젝트로 CWD를 이동해도 훅이 동작하도록 **모든 서브프로젝트에도 훅 스크립트를 복사**합니다.

```
[훅 등록]
  {프로젝트루트}/.claude/settings.local.json  ← hooks 등록 (루트에만, 상대 경로)

[훅 스크립트 배포]
  {프로젝트루트}/.claude/hooks/*.sh           ← 원본
  {서브프로젝트A}/.claude/hooks/*.sh          ← 복사본
  {서브프로젝트B}/.claude/hooks/*.sh          ← 복사본
```

> **왜 서브프로젝트에도 복사하는가?** 훅 명령은 Claude의 **현재 CWD**에서 실행됩니다. Claude가 서브프로젝트로 이동하면 상대 경로가 서브프로젝트 기준으로 해석되므로, 해당 위치에도 훅 스크립트가 있어야 합니다. 절대 경로는 에이전트팀(worktree) 환경에서 원본 레포를 참조하는 문제가 있어 사용하지 않습니다.

`settings.local.json` 훅 블록 형식 (상대 경로):
```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "matcher": "",
      "hooks": [{"type": "command", "command": "bash .claude/hooks/workflow-state.sh"}]
    }],
    "Stop": [{
      "matcher": "",
      "hooks": [{"type": "command", "command": "bash .claude/hooks/stop-guard.sh"}]
    }],
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{"type": "command", "command": "bash .claude/hooks/dangerous-cmd-guard.sh"}]
    }]
  }
}
```

> `settings.local.json`에 기존 내용이 있으면 `hooks` 블록만 병합합니다. 기존 `permissions`, `enabledMcpjsonServers` 등은 보존.

**에이전트팀 활성화 시 `.claude/settings.json` 추가 등록**:

팀원 worktree에서는 `settings.local.json`이 복사되지 않으므로, git-tracked인 `.claude/settings.json`에도 동일한 hooks 블록을 등록합니다. worktree에는 git-tracked 파일이 복사되므로 훅 스크립트 + settings.json 모두 존재하게 됩니다.

### 4.3 디렉토리 생성 (루트만)

```bash
mkdir -p .forge-flow/design/   # 작업별 설계 문서
mkdir -p .forge-flow/state/    # 세션별 상태 파일
```

> **모노레포도 루트에만**: `.forge-flow/`(설계 문서 + 상태 파일)는 어느 서브프로젝트에서 Claude를 열어도 동일하게 루트 기준으로 동작합니다. 워크플로 상태와 설계 문서는 레포 전체에서 하나의 위치에 집중.

### 4.4 훅 스크립트 생성

아래 3개 스크립트를 루트의 `.claude/hooks/`에 **그대로** 생성합니다.

`chmod +x .claude/hooks/*.sh` 실행.

> 아래 스크립트 내용이 **정본(single source of truth)**입니다. 수정·생략·재해석하지 말고 그대로 Write합니다.

#### workflow-state.sh

```bash
#!/bin/bash
# forge-flow v3.2.0 UserPromptSubmit Hook
# 워크플로 진입 보장 + 상태 알림 + orphan 감지 + 에이전트팀 팀원 감지
#
# 등록: settings.local.json hooks.UserPromptSubmit
# stdin: (사용자 프롬프트 정보)
# stdout: { "additionalContext": "..." }

INPUT=$(cat)
SESSION_ID="${CLAUDE_SESSION_ID}"
STATE_FILE=".forge-flow/state/state-${SESSION_ID}.json"

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
    key="${key%% //*}"  # // default 제거
    python3 -c "import json; d=json.load(open('$2')); print(d.get('$key',''))" 2>/dev/null
  }
fi

# 0. 상태 파일 정리
# - completed 상태: 즉시 삭제 (+ 연결된 design 파일도 삭제)
if ls .forge-flow/state/state-*.json 1>/dev/null 2>&1; then
  for sf in .forge-flow/state/state-*.json; do
    [ -f "$sf" ] || continue
    SF_PHASE=$(_json_read '.phase' "$sf")
    if [ "$SF_PHASE" = "completed" ]; then
      SF_DESIGN=$(_json_read '.design_file' "$sf")
      [ -n "$SF_DESIGN" ] && [ -f "$SF_DESIGN" ] && rm -f "$SF_DESIGN"
      rm -f "$sf"
    fi
  done
fi
# - 7일 이상 경과: 안전망 삭제
find .forge-flow/state/ -name "state-*.json" -mtime +7 -delete 2>/dev/null

# 1. 기존 세션 — 상태 파일 기반 컨텍스트 주입
if [ -f "$STATE_FILE" ]; then
  PHASE=$(_json_read '.phase' "$STATE_FILE")
  DESIGN_FILE=$(_json_read '.design_file' "$STATE_FILE")
  SCALE=$(_json_read '.scale' "$STATE_FILE")
  [ -z "$DESIGN_FILE" ] && DESIGN_FILE="없음"
  [ -z "$SCALE" ] && SCALE="미정"

  case "$PHASE" in
    clarifying)
      echo "{\"additionalContext\": \"[WORKFLOW] 요구사항 명확화 중. design: $DESIGN_FILE [COMPACT] 현재 단계에서는 /compact를 피하세요 — 사용자와의 대화 맥락이 아직 design 문서에 확정되지 않았습니다.\"}" ;;
    reviewing-req)
      echo "{\"additionalContext\": \"[WORKFLOW] 요구사항 검수 중. design: $DESIGN_FILE [COMPACT] 현재 단계에서는 /compact를 피하세요 — 검수 피드백 반영 맥락이 손실될 수 있습니다.\"}" ;;
    planning)
      echo "{\"additionalContext\": \"[WORKFLOW] 설계 중. design: $DESIGN_FILE [COMPACT] 컨텍스트가 길어졌다면 plan 완료 후 /compact를 권장합니다.\"}" ;;
    reviewing-plan)
      echo "{\"additionalContext\": \"[WORKFLOW] 설계 검수 중. design: $DESIGN_FILE [COMPACT] 현재 단계에서는 /compact를 피하세요 — 검수 피드백 반영 맥락이 손실될 수 있습니다.\"}" ;;
    implementing)
      echo "{\"additionalContext\": \"[WORKFLOW] 구현 중 (규모: $SCALE). design 문서의 '따를 기존 패턴' 섹션을 반드시 참조하여 기존 코드 패턴과 일관되게 구현하세요. 완료 시 /forge-flow:verify 필수. design: $DESIGN_FILE [COMPACT] 구현 시작 전이라면 /compact 권장. 구현 중간에는 피하세요.\"}" ;;
    verifying)
      echo "{\"additionalContext\": \"[WORKFLOW] 검수 진행 중. design: $DESIGN_FILE [COMPACT] 현재 단계에서는 /compact를 피하세요 — 검수 결과 맥락이 손실될 수 있습니다.\"}" ;;
    verified)
      echo "{\"additionalContext\": \"[WORKFLOW] 검수 완료. /forge-flow:complete로 작업을 마무리하세요. design: $DESIGN_FILE [COMPACT] 컨텍스트가 길어졌다면 /compact 후 마무리해도 안전합니다.\"}" ;;
    tested)
      echo "{\"additionalContext\": \"[WORKFLOW] 테스트 완료. /forge-flow:complete로 작업을 마무리하세요. design: $DESIGN_FILE [COMPACT] 컨텍스트가 길어졌다면 /compact 후 마무리해도 안전합니다.\"}" ;;
    completing)
      echo "{\"additionalContext\": \"[WORKFLOW] 작업 마무리 중. design: $DESIGN_FILE\"}" ;;
    completed)
      echo "{\"additionalContext\": \"[WORKFLOW] 작업 완료.\"}" ;;
    *)
      echo "{\"additionalContext\": \"[WORKFLOW] 현재 단계: $PHASE. design: $DESIGN_FILE\"}" ;;
  esac
  exit 0
fi

# 2. 새 세션이지만 .forge-flow/design/ 파일 존재 — orphan 감지
if ls .forge-flow/design/*.md 1>/dev/null 2>&1; then
  ORPHANS=""
  for f in .forge-flow/design/*.md; do
    BASENAME=$(basename "$f")
    # 정확한 파일명 매칭 (부분 문자열 오탐 방지)
    REFERENCED=$(grep -rl "\".forge-flow/design/${BASENAME}\"" .forge-flow/state/state-*.json 2>/dev/null)
    if [ -z "$REFERENCED" ]; then
      ORPHANS="$ORPHANS ${BASENAME}"
    fi
  done

  if [ -n "$ORPHANS" ]; then
    # orphan design 파일 자동 정리
    for orphan in $ORPHANS; do
      rm -f ".forge-flow/design/${orphan}"
    done
    echo "{\"additionalContext\": \"[WORKFLOW] 이전 작업의 orphan 파일 정리됨:$ORPHANS. 새 작업은 /forge-flow:clarify로 시작하세요.\"}"
  else
    echo "{\"additionalContext\": \"[WORKFLOW] 새 작업을 시작하려면 /forge-flow:clarify로 요구사항을 먼저 명확히 하세요.\"}"
  fi
  exit 0
fi

# 3. 완전히 새로운 세션 — 워크플로 진입 안내
echo '{"additionalContext": "[WORKFLOW] 새 작업을 시작하려면 /forge-flow:clarify로 요구사항을 먼저 명확히 하세요."}'
exit 0
```

#### stop-guard.sh

```bash
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
```

#### dangerous-cmd-guard.sh

```bash
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
```

### 4.5 서브프로젝트 훅 스크립트 복사 (모노레포)

모노레포인 경우, 1단계에서 감지한 **모든 서브프로젝트**에 훅 스크립트를 복사합니다.

```bash
# 각 서브프로젝트에 훅 스크립트 복사
for subdir in {서브프로젝트 목록}; do
  mkdir -p "${subdir}/.claude/hooks/"
  cp .claude/hooks/*.sh "${subdir}/.claude/hooks/"
  chmod +x "${subdir}/.claude/hooks/"*.sh
done
```

> **settings.local.json은 복사하지 않습니다.** 훅 등록은 루트에만 존재하며, 서브프로젝트에는 **스크립트 파일만** 복사합니다. Claude가 CWD를 이동해도 상대 경로로 스크립트를 찾을 수 있게 하기 위함입니다.

> **단일 레포**: 이 단계를 스킵합니다.

### 4.6 조건부 설정

| 조건 | 설정 |
|------|------|
| FE 프로젝트 감지 | fe-check 활성화 (CLAUDE.md에 FE 빌드 명령 추가) |
| 에이전트팀 활성화 | 루트 `settings.local.json`에 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 환경변수 주입 |
| 에이전트팀 활성화 | `.claude/settings.json`(프로젝트 공유)에도 hooks 블록 병합 — 팀원 worktree에서 훅 동작 보장 |

> **settings.json 이중 등록**: `settings.local.json`은 gitignore 대상이므로 팀원의 worktree에 복사되지 않습니다. 에이전트팀 활성화 시 `.claude/settings.json`에도 동일한 hooks 블록을 등록하여 팀원이 훅을 로드할 수 있게 합니다. `settings.json`은 git-tracked 파일이므로 worktree에 포함됩니다.

### 4.7 .gitignore 업데이트 (루트만)

```bash
# 루트 .gitignore에 추가
.forge-flow/
```

> `.forge-flow/` 전체가 gitignore 대상 (설계 문서 + 상태 파일 모두 포함).

### 4.8 훅 스크립트 git 추적 설정

`.claude/hooks/*.sh`는 **반드시 git에 추적**되어야 합니다. 에이전트팀(worktree)에서 훅이 동작하려면 git이 관리하는 파일이어야 worktree에 복사됩니다.

```bash
# .claude/ 전체가 gitignore된 경우 → 예외 추가
# .gitignore에 아래 추가:
!.claude/hooks/

# 훅 스크립트를 git에 추가
git add -f .claude/hooks/*.sh
```

> `settings.local.json`은 개인 설정이므로 gitignore 유지. 훅 스크립트만 추적.

---

## 5단계: 검증 + 결과 보고

| 검증 항목 | 확인 방법 |
|----------|---------|
| CLAUDE.md 마커 | `forge-flow:version=X.X.X` 존재 확인 (루트) |
| CLAUDE.md 워크플로 섹션 | `/forge-flow:clarify`, `/forge-flow:verify` 등 스킬명 포함 |
| 루트 훅 스크립트 | `{루트}/.claude/hooks/stop-guard.sh` 존재 + 실행 권한 |
| 루트 settings 훅 | `{루트}/.claude/settings.local.json` hooks 키 존재 |
| design 디렉토리 | `{루트}/.forge-flow/design/` 존재 |
| .forge-flow 디렉토리 | `{루트}/.forge-flow/` 존재 |
| [모노레포] 서브프로젝트 훅 | 각 서브프로젝트에 `.claude/hooks/*.sh` 존재 + 실행 권한 |
| [에이전트팀] 환경변수 | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 설정 확인 |
| [에이전트팀] settings.json | `.claude/settings.json`에 hooks 블록 존재 확인 |

결과 보고 형식:
```
forge-flow v3.2.0 설치 완료

[루트 설치 항목]
  ✅ CLAUDE.md      — 워크플로 섹션 + 브랜치 전략 + 빌드 명령
  ✅ hooks          — Stop + UserPromptSubmit + PreToolUse
  ✅ .forge-flow/   — 설계 문서 + 세션별 상태 파일 디렉토리

[워크플로 순서]
  /forge-flow:clarify → /forge-flow:review-req → /forge-flow:plan
  → (조건부) /forge-flow:review-plan → 구현 → /forge-flow:verify
  → /forge-flow:test → /forge-flow:complete

[스킬 목록]
  /forge-flow:clarify      요구사항 명확화 (자동)
  /forge-flow:review-req   요구사항 교차검증 (자동)
  /forge-flow:plan         구현 계획 설계 (자동)
  /forge-flow:review-plan  설계 검수 (조건부)
  /forge-flow:verify       작업 종합 검수 (자동)
  /forge-flow:test         실행 테스트 (자동)
  /forge-flow:complete     작업 마무리 — 커밋 + 정리 (자동)
  /forge-flow:build-check  빌드 검증 (verify 내부)
  /forge-flow:fe-check     FE 검증 (verify 내부, FE 프로젝트만)
```

---

## --update 흐름

### 1단계: 버전 비교

CLAUDE.md의 `<!-- forge-flow:version=X.X.X -->` 마커와 plugin.json의 `requires_update` 비교:
- 마커 ≥ `requires_update` → "프로젝트 설정이 최신입니다 (vX.X.X)" 출력 후 종료
- 마커 < `requires_update` → 2단계로 진행

> `requires_update`는 훅/CLAUDE.md 섹션이 변경된 버전을 가리킵니다. 스킬만 변경된 배포에서는 이 값이 올라가지 않으므로 --update가 불필요합니다.

### 2단계: 변경 사항 분석 + 리포트

update를 실행하기 전, 변경될 내용을 사용자에게 **먼저 보고**합니다.

**변경 내용 파악 방법**:
1. 이 플러그인의 `CHANGELOG.md` 파일을 읽어 현재 프로젝트 버전 ~ 최신 버전 사이의 모든 변경 항목을 수집
2. 수집한 변경 항목을 기반으로 **사용자 보고용** 리포트 생성

> **⚠️ CHANGELOG는 사용자 리포트 전용입니다.** 실제 update 실행 시 CHANGELOG 내용을 해석하여 코드를 수정하지 않습니다. 훅 스크립트는 4.4 섹션의 정본을 그대로 복사하고, 템플릿은 templates/ 파일을 그대로 적용합니다.

**리포트 형식**:
```
[forge-flow update] v{현재버전} → v{최신버전}

[변경 예정 항목] (CHANGELOG.md 기반)
  {CHANGELOG에서 해당 버전 범위의 변경 항목을 나열}

[훅 스크립트 비교] (플러그인 최신본과 내용 diff)
  ✅ .claude/hooks/workflow-state.sh      — 최신 / 🔄 갱신 필요
  ✅ .claude/hooks/stop-guard.sh          — 최신 / 🔄 갱신 필요
  ✅ .claude/hooks/dangerous-cmd-guard.sh — 최신 / 🔄 갱신 필요

[변경하지 않는 항목]
  ⏭️ 빌드 명령 — 프로젝트 커스텀 (보존)
  ⏭️ 변경 전파 체인 — 프로젝트 커스텀 (보존)
  ⏭️ 브랜치 전략 — 프로젝트 커스텀 (보존)
  ⏭️ 에이전트팀 설정 — 프로젝트 커스텀 (보존)
  ⏭️ 프로젝트 고유 섹션 — 보존

적용할까요? [Y/n]
```

### 3단계: 변경 실행

사용자 동의 후 실행:

1. **훅 스크립트 덮어쓰기**:
   - **⚠️ 중요: CHANGELOG 기반으로 기존 훅을 수정하지 않습니다.**
   - **반드시 위 `4.4 훅 스크립트 생성` 섹션의 코드 블록 내용을 그대로 Write합니다.**
   - 기존 프로젝트의 훅 파일 내용은 무시하고, 4.4의 정본으로 전체 교체(덮어쓰기)합니다.
   - **루트에만 적용**
   - 실행 권한 설정 (`chmod +x`)
2. **hooks 등록 경로 정규화**:
   - `settings.local.json`의 hooks 명령에서 **절대 경로를 상대 경로로 교체** (기존 절대 경로 마이그레이션)
   - `bash /absolute/path/.claude/hooks/...` → `bash .claude/hooks/...`
3. **서브프로젝트 훅 스크립트 동기화** (모노레포):
   - 루트의 `.claude/hooks/*.sh`를 모든 서브프로젝트에 복사
   - 기존 서브프로젝트 훅 파일은 덮어쓰기
4. **CLAUDE.md 버전 마커 갱신**: `<!-- forge-flow:version=X.X.X -->`를 plugin.json의 `requires_update` 값으로 교체
5. **CLAUDE.md 템플릿 섹션 갱신** (해당 시):
   - `<!-- SECTION: 작업 원칙 -->` — 템플릿 기준으로 교체
   - `<!-- SECTION: 워크플로 -->` — 템플릿 기준으로 교체

### 4단계: 결과 보고

```
[update 완료] v{이전버전} → v{최신버전}

[루트 훅]
  🔄 workflow-state.sh      — 갱신됨  (또는 ⏭️ 변경 없음)
  🔄 stop-guard.sh          — 갱신됨
  🔄 dangerous-cmd-guard.sh — 갱신됨
  ✅ CLAUDE.md 버전 마커 — {최신버전}

⏭️ 프로젝트 설정 — 보존됨
```

### update 범위 규칙 (중요)

**update가 건드리는 것**:
- 버전 마커
- `<!-- SECTION: 작업 원칙 -->` 섹션
- `<!-- SECTION: 워크플로 -->` 섹션
- 루트의 `.claude/hooks/` 3개 훅 스크립트
- `settings.local.json` hooks 명령 경로 정규화 (절대 → 상대 마이그레이션)
- 서브프로젝트 훅 스크립트 동기화 (모노레포)

**update가 절대 건드리지 않는 것**:
- `<!-- SECTION: 빌드 명령 -->` — 프로젝트 커스텀
- `<!-- SECTION: 변경 전파 체인 -->` — 프로젝트 커스텀
- `<!-- SECTION: 브랜치 전략 -->` — 프로젝트 커스텀
- `<!-- SECTION: 에이전트팀 -->` — 프로젝트 커스텀
- SECTION 마커 없는 프로젝트 고유 섹션 (MCP 원칙, 기술 스택 등)

미정이었던 항목(빌드/테스트 명령) 재수집도 이 옵션으로 처리.

---

## --reset 흐름

```
1. .forge-flow/design/ 보존 여부 확인
2. 전체 제거 (루트의 hooks, .forge-flow/, CLAUDE.md 워크플로 섹션)
3. 1단계부터 재시작
```

---

## --purge 흐름

```
1. "forge-flow를 완전히 제거합니다. 계속하시겠습니까?" 확인
2. 제거 대상 (루트):
   - .claude/hooks/stop-guard.sh, workflow-state.sh, dangerous-cmd-guard.sh
   - .forge-flow/
   - CLAUDE.md 워크플로 섹션
   - settings.local.json hooks 블록
3. .forge-flow/design/ 보존 여부 확인 (사용자 데이터)
```
