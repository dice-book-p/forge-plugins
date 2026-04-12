---
name: setup-workflow
description: "forge-flow 워크플로를 프로젝트에 설치합니다."
---

# /forge-flow:setup-workflow  `v3.4.0`

프로젝트에 forge-flow 워크플로를 설치합니다.
단일 레포, 모노레포 모두 자동 감지하여 올바르게 설치합니다.

## ARGUMENTS

```
/forge-flow:setup-workflow                # 프로젝트 워크플로 설정 (CLAUDE.md + .forge-flow/)
/forge-flow:setup-workflow --global       # 글로벌 훅 설치 (~/.claude/forge-flow-hooks/ + 글로벌 settings.json)
/forge-flow:setup-workflow --global --update  # 글로벌 훅 스크립트 갱신
/forge-flow:setup-workflow --update       # 프로젝트 CLAUDE.md 갱신 + 프로젝트별 훅 정리
/forge-flow:setup-workflow --reset        # 전체 제거 → Q&A → 재설치
/forge-flow:setup-workflow --purge        # 프로젝트 제거 (글로벌 훅 유지)
/forge-flow:setup-workflow --purge --global   # 프로젝트 + 글로벌 훅 모두 제거
```

---

## 실행 흐름 개요

```
1단계: 프로젝트 상태 판별 (기존 vs 신규) + 구조 감지 (단일/모노레포)
2단계: 정보 수집 (자동 감지 + 확인 / Q&A)
4단계: 설치 실행
  4.1 CLAUDE.md 패치 (루트)
  4.2 플러그인 설치 경로 탐지
  4.3 글로벌 훅 확인
  4.4 디렉토리 생성 (루트)
  4.5 조건부 설정
  4.6 .gitignore 업데이트 (루트)
  4.7 기존 훅 스크립트 정리 (마이그레이션)
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
| _(에이전트팀 섹션)_ | 템플릿에 직접 포함 (필수, 플레이스홀더 없음) |

### 4.2 플러그인 설치 경로 탐지

훅 스크립트를 프로젝트에 복사하지 않고, 플러그인 설치 경로에서 직접 실행합니다.
`~/.claude/plugins/installed_plugins.json`에서 forge-flow 설치 경로를 탐지합니다:

```bash
# installed_plugins.json은 version 1 또는 version 2 형식일 수 있음
# v1: {"forge-flow@forge-plugins": {"installPath": "..."}}
# v2: {"version": 2, "plugins": {"forge-flow@forge-plugins": [{"installPath": "..."}]}}

# jq 사용
PLUGIN_DIR=$(jq -r '
  if .version == 2 then
    .plugins["forge-flow@forge-plugins"][0].installPath
  else
    .["forge-flow@forge-plugins"].installPath
  end
' ~/.claude/plugins/installed_plugins.json 2>/dev/null)

# python3 폴백
if [ -z "$PLUGIN_DIR" ] || [ "$PLUGIN_DIR" = "null" ]; then
  PLUGIN_DIR=$(python3 -c "
import json, os
f = os.path.expanduser('~/.claude/plugins/installed_plugins.json')
d = json.load(open(f))
if d.get('version') == 2:
    entries = d.get('plugins', {}).get('forge-flow@forge-plugins', [])
    print(entries[0].get('installPath', '') if entries else '')
else:
    print(d.get('forge-flow@forge-plugins', {}).get('installPath', ''))
" 2>/dev/null)
fi

HOOKS_DIR="${PLUGIN_DIR}/skills/setup-workflow/hooks"
```

탐지 실패 시 → 에러: "forge-flow 플러그인 설치 경로를 찾을 수 없습니다. `claude plugin add forge-flow`로 설치 후 다시 실행하세요."

탐지 성공 시 → `$HOOKS_DIR` 경로의 3개 스크립트 존재를 확인:
- `${HOOKS_DIR}/workflow-state.sh`
- `${HOOKS_DIR}/stop-guard.sh`
- `${HOOKS_DIR}/dangerous-cmd-guard.sh`

### 4.3 글로벌 훅 확인

프로젝트별 훅 등록은 하지 않습니다. 글로벌 훅 설치 여부를 확인합니다:
- `~/.claude/forge-flow-hooks/` 디렉토리 존재 확인
- `~/.claude/settings.json`에 forge-flow hooks 블록 존재 확인

**글로벌 훅 설치됨** → "글로벌 훅이 활성화되어 있습니다." 안내 → 다음 단계로
**글로벌 훅 미설치** → "글로벌 훅이 설치되지 않았습니다." 안내 후 자동으로 --global 흐름 실행

> v3.4.0부터 훅은 글로벌로만 등록합니다. 프로젝트별 `settings.local.json` / `settings.json`에는 훅을 등록하지 않습니다.

### 4.4 디렉토리 생성 (루트만)

```bash
mkdir -p .forge-flow/design/   # 작업별 설계 문서
mkdir -p .forge-flow/state/    # 세션별 상태 파일
```

> **모노레포도 루트에만**: `.forge-flow/`(설계 문서 + 상태 파일)는 어느 서브프로젝트에서 Claude를 열어도 동일하게 루트 기준으로 동작합니다. 워크플로 상태와 설계 문서는 레포 전체에서 하나의 위치에 집중.

### 훅 스크립트 레퍼런스

아래 3개 스크립트는 플러그인 설치 경로(`skills/setup-workflow/hooks/`)에 위치합니다. `--global` 실행 시 `~/.claude/forge-flow-hooks/`에는 **래퍼 스크립트**가 생성되며, 래퍼가 런타임에 플러그인 경로를 동적 탐색하여 아래 스크립트를 실행합니다.

> 이 섹션은 훅 스크립트의 내용을 문서화한 **레퍼런스**입니다. 실제 실행되는 스크립트는 플러그인 설치 경로의 파일이며, 플러그인 업데이트 시 자동으로 최신 버전이 사용됩니다.

> 아래 스크립트 내용은 플러그인 설치 경로의 파일과 동일한 **레퍼런스**입니다. 프로젝트에 복사하거나 Write하지 않습니다.

#### workflow-state.sh

```bash
#!/bin/bash
# forge-flow v3.4.0 UserPromptSubmit Hook
# 워크플로 진입 보장 + 상태 알림 + orphan 감지 + 에이전트팀 팀원 감지
#
# 등록: ~/.claude/settings.json hooks.UserPromptSubmit (글로벌)
# stdin: (사용자 프롬프트 정보)
# stdout: { "additionalContext": "..." }

INPUT=$(cat)

# forge-flow 미설치 프로젝트에서는 즉시 종료 (글로벌 훅 안전 가드)
[ -d ".forge-flow" ] || exit 0

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
# forge-flow v3.4.0 Stop Hook (command 타입)
# 워크플로 미완료 시 종료 차단 + circuit breaker + 에이전트팀 팀원 바이패스
#
# 등록: ~/.claude/settings.json hooks.Stop (글로벌)
# stdin: { "stop_hook_active": bool, "last_assistant_message": "..." }
# stdout: { "decision": "block", "reason": "..." } 또는 빈 출력(허용)

INPUT=$(cat)

# forge-flow 미설치 프로젝트에서는 즉시 종료 (글로벌 훅 안전 가드)
[ -d ".forge-flow" ] || exit 0

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
# forge-flow v3.4.0 PreToolUse Hook — 위험 작업 차단
#
# 등록: ~/.claude/settings.json hooks.PreToolUse (글로벌, matcher: "Bash")
# stdin: { "tool_name": "Bash", "tool_input": { "command": "..." } }
# stdout: { "permissionDecision": "deny", "reason": "..." } 또는 빈 출력(허용)

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

### 4.5 조건부 설정

| 조건 | 설정 |
|------|------|
| FE 프로젝트 감지 | fe-check 활성화 (CLAUDE.md에 FE 빌드 명령 추가) |

### 4.6 .gitignore 업데이트 (루트만)

```bash
# 루트 .gitignore에 추가
.forge-flow/
```

> `.forge-flow/` 전체가 gitignore 대상 (설계 문서 + 상태 파일 모두 포함).

### 4.7 기존 훅 스크립트 정리 (마이그레이션)

v3.2.0 이하에서 업그레이드하는 경우, 프로젝트에 복사되어 있던 훅 스크립트를 정리합니다.

```bash
# 기존 스크립트 파일 삭제 (더 이상 프로젝트에 복사하지 않음)
rm -f .claude/hooks/workflow-state.sh
rm -f .claude/hooks/stop-guard.sh
rm -f .claude/hooks/dangerous-cmd-guard.sh

# .claude/hooks/ 디렉토리가 비었으면 삭제
rmdir .claude/hooks/ 2>/dev/null

# git 추적에서도 제거
git rm -f --cached .claude/hooks/*.sh 2>/dev/null

# .gitignore에서 !.claude/hooks/ 예외 규칙이 있으면 제거
```

> **모노레포**: 서브프로젝트에 복사된 `.claude/hooks/*.sh`도 동일하게 정리합니다.
> **신규 설치**: 이 단계를 스킵합니다 (정리할 파일 없음).

---

## 5단계: 검증 + 결과 보고

| 검증 항목 | 확인 방법 |
|----------|---------|
| CLAUDE.md 마커 | `forge-flow:version=X.X.X` 존재 확인 (루트) |
| CLAUDE.md 워크플로 섹션 | `/forge-flow:clarify`, `/forge-flow:verify` 등 스킬명 포함 |
| 글로벌 hooks | `~/.claude/settings.json` hooks 키 존재 + `~/.claude/forge-flow-hooks/` 래퍼 스크립트 존재 + `_resolve_plugin_dir` 함수 포함 확인 |
| design 디렉토리 | `{루트}/.forge-flow/design/` 존재 |
| .forge-flow 디렉토리 | `{루트}/.forge-flow/` 존재 |
| 기존 훅 정리 | `{루트}/.claude/hooks/*.sh`가 **존재하지 않는지** 확인 (마이그레이션 완료) |
| 환경변수 | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 설정 확인 |

결과 보고 형식:
```
forge-flow v3.4.0 설치 완료

[루트 설치 항목]
  ✅ CLAUDE.md      — 워크플로 섹션 + 브랜치 전략 + 빌드 명령
  ✅ hooks          — 글로벌 훅 활성화 (~/.claude/forge-flow-hooks/)
  ✅ .forge-flow/   — 설계 문서 + 세션별 상태 파일 디렉토리

[훅 경로]
  ~/.claude/forge-flow-hooks/workflow-state.sh
  ~/.claude/forge-flow-hooks/stop-guard.sh
  ~/.claude/forge-flow-hooks/dangerous-cmd-guard.sh

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

## --global 흐름

글로벌 훅을 설치합니다. `~/.claude/forge-flow-hooks/`에 **래퍼 스크립트**를 생성하고, `~/.claude/settings.json`에 등록합니다. 래퍼는 런타임에 플러그인 설치 경로를 동적 탐색하므로, 플러그인 업데이트 시 수동 갱신이 필요 없습니다.

### 1단계: 플러그인 경로 탐지 + 검증

4.2 절차와 동일하게 `installed_plugins.json`에서 forge-flow 설치 경로를 탐지합니다. 이 단계는 **설치 시점 검증용**이며, 실제 훅 실행 시에는 래퍼가 동적으로 경로를 탐색합니다.

### 2단계: 래퍼 스크립트 생성

래퍼 스크립트는 `installed_plugins.json`에서 플러그인 경로를 런타임에 탐색하여 실제 훅 스크립트에 위임합니다. 버전이 포함된 경로를 하드코딩하지 않으므로 플러그인 업데이트 후에도 자동으로 최신 버전을 사용합니다.

```bash
mkdir -p ~/.claude/forge-flow-hooks/
```

아래 래퍼 템플릿으로 3개 스크립트를 생성합니다. `{HOOK_NAME}` 부분만 각각 `workflow-state`, `stop-guard`, `dangerous-cmd-guard`로 치환:

```bash
#!/bin/bash
# forge-flow hook wrapper — 플러그인 경로 동적 탐색
# 플러그인 업데이트 시 수동 갱신 불필요
_resolve_plugin_dir() {
  local f="$HOME/.claude/plugins/installed_plugins.json"
  [ -f "$f" ] || return 1
  if command -v jq >/dev/null 2>&1; then
    jq -r 'if .version==2 then .plugins["forge-flow@forge-plugins"][0].installPath else .["forge-flow@forge-plugins"].installPath end' "$f" 2>/dev/null
  else
    python3 -c "
import json,os
d=json.load(open(os.path.expanduser('~/.claude/plugins/installed_plugins.json')))
e=d.get('plugins',{}).get('forge-flow@forge-plugins',[{}]) if d.get('version')==2 else [d.get('forge-flow@forge-plugins',{})]
print(e[0].get('installPath','') if e else '')" 2>/dev/null
  fi
}
PLUGIN_DIR=$(_resolve_plugin_dir)
HOOK="${PLUGIN_DIR}/skills/setup-workflow/hooks/{HOOK_NAME}.sh"
[ -n "$PLUGIN_DIR" ] && [ -f "$HOOK" ] && exec bash "$HOOK" || exit 0
```

```bash
chmod +x ~/.claude/forge-flow-hooks/*.sh
```

> **설계 원칙**: 래퍼는 경로 탐색 + 위임만 수행. 비즈니스 로직은 플러그인 내부 `hooks/` 디렉토리의 실제 스크립트에만 존재. `installed_plugins.json` 파싱은 ~10ms로 체감 불가.

### 3단계: 글로벌 settings.json 훅 등록

`~/.claude/settings.json`에 hooks 블록을 등록합니다. 기존 내용이 있으면 hooks 블록만 병합합니다.

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "matcher": "",
      "hooks": [{"type": "command", "command": "bash ~/.claude/forge-flow-hooks/workflow-state.sh"}]
    }],
    "Stop": [{
      "matcher": "",
      "hooks": [{"type": "command", "command": "bash ~/.claude/forge-flow-hooks/stop-guard.sh"}]
    }],
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{"type": "command", "command": "bash ~/.claude/forge-flow-hooks/dangerous-cmd-guard.sh"}]
    }]
  }
}
```

### 4단계: 환경변수 확인

`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 환경변수가 설정되어 있는지 확인하고, 미설정 시 설정 안내를 표시합니다.

### 5단계: 결과 보고

```
forge-flow 글로벌 훅 설치 완료

[글로벌 훅 — 래퍼 방식]
  ✅ ~/.claude/forge-flow-hooks/workflow-state.sh  (래퍼 → 플러그인 동적 탐색)
  ✅ ~/.claude/forge-flow-hooks/stop-guard.sh      (래퍼 → 플러그인 동적 탐색)
  ✅ ~/.claude/forge-flow-hooks/dangerous-cmd-guard.sh (래퍼 → 플러그인 동적 탐색)
  ✅ ~/.claude/settings.json hooks 등록 완료

  플러그인 업데이트 시 자동으로 최신 훅 사용 (수동 갱신 불필요)

[다음 단계]
  각 프로젝트에서 /forge-flow:setup-workflow 실행 (훅 등록 없이 CLAUDE.md + .forge-flow/ 만 설정)
```

---

## --global --update 흐름

래퍼 방식 도입 이후, 플러그인 업데이트 시 `--global --update`는 **일반적으로 불필요**합니다. 래퍼가 런타임에 최신 플러그인 경로를 자동 탐색하기 때문입니다.

이 명령은 아래 경우에만 필요합니다:
- **기존 복사본 → 래퍼 마이그레이션**: v3.4.2 이하에서 설치한 글로벌 훅(실제 스크립트 복사본)을 래퍼로 전환
- **래퍼 형식 자체 변경**: 래퍼 템플릿 구조가 변경된 경우 (극히 드뭄)

### 실행 흐름

1. **래퍼 여부 감지**: `~/.claude/forge-flow-hooks/workflow-state.sh` 첫 줄에 `_resolve_plugin_dir` 함수가 있으면 래퍼, 없으면 기존 복사본
2. **기존 복사본인 경우** → --global 2단계(래퍼 생성)를 재실행하여 래퍼로 교체
3. **이미 래퍼인 경우** → 래퍼 템플릿이 최신인지 확인, 필요 시 갱신
4. 글로벌 settings.json hooks 경로 확인 (이미 `~/.claude/forge-flow-hooks/`면 변경 없음)
5. 결과 보고: "글로벌 훅 래퍼 확인/갱신 완료"

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

> **⚠️ CHANGELOG는 사용자 리포트 전용입니다.** 실제 update 실행 시 CHANGELOG 내용을 해석하여 코드를 수정하지 않습니다. 훅 스크립트는 플러그인 설치 경로에서 직접 참조하며, 템플릿은 templates/ 파일을 그대로 적용합니다.

**리포트 형식**:
```
[forge-flow update] v{현재버전} → v{최신버전}

[변경 예정 항목] (CHANGELOG.md 기반)
  {CHANGELOG에서 해당 버전 범위의 변경 항목을 나열}

[훅 정리]
  🗑️ 프로젝트별 hooks 블록 제거 (settings.local.json / settings.json)
  🗑️ 기존 .claude/hooks/*.sh — 정리됨 (해당 시)
  ✅ 글로벌 훅 확인 (~/.claude/forge-flow-hooks/)

[변경하지 않는 항목]
  ⏭️ 빌드 명령 — 프로젝트 커스텀 (보존)
  ⏭️ 변경 전파 체인 — 프로젝트 커스텀 (보존)
  ⏭️ 브랜치 전략 — 프로젝트 커스텀 (보존)
  ⏭️ 프로젝트 고유 섹션 — 보존

적용할까요? [Y/n]
```

### 3단계: 변경 실행

사용자 동의 후 실행:

1. **플러그인 경로 재탐지** (4.2 절차)
2. **프로젝트별 훅 등록 정리** (글로벌로 이전):
   - `settings.local.json`에서 forge-flow hooks 블록 제거 (있으면)
   - `.claude/settings.json` (프로젝트)에서 forge-flow hooks 블록 제거 (있으면)
   - **하드코딩된 플러그인 캐시 경로** (`plugins/cache/forge-plugins/forge-flow/{버전}/...`) 참조가 있으면 반드시 제거
   - 기존 `.claude/hooks/*.sh` 파일 삭제 (v3.0.0~v3.1.x 레거시)
   - git 추적에서 제거
3. **글로벌 훅 확인**: `~/.claude/forge-flow-hooks/` 미설치 시 → "--global을 실행하세요" 안내. 설치되어 있지만 래퍼가 아닌 복사본이면 → "--global --update로 래퍼로 전환하세요" 안내
4. **CLAUDE.md 버전 마커 갱신**: `<!-- forge-flow:version=X.X.X -->`를 plugin.json의 `requires_update` 값으로 교체
5. **CLAUDE.md 템플릿 섹션 갱신** (해당 시):
   - `<!-- SECTION: 작업 원칙 -->` — 템플릿 기준으로 교체
   - `<!-- SECTION: 워크플로 -->` — 템플릿 기준으로 교체
   - `<!-- SECTION: 에이전트팀 (선택) -->` → `<!-- SECTION: 에이전트팀 -->` 으로 마커 교체 + 내용 갱신
   - 에이전트팀 섹션이 없으면 → 새로 추가 (v3.4.0 필수)
6. **rework-log 마이그레이션** (v3.4.1):
   - `.forge-flow/rework-log.md` 존재 시 각 항목을 스캔
   - 차원 태그(`[코드]`, `[평가]` 등)가 없는 항목에만 `[코드]` 태그 자동 부여
   - 기존 태그가 있는 항목은 그대로 유지
7. **검수 이력 분리 마이그레이션** (v3.4.1):
   - `.forge-flow/design/` 내 design 파일 스캔
   - **진행 중 작업 제외**: `.forge-flow/state/`에 해당 task_id의 상태 파일이 존재하고 phase가 `"completed"`가 아니면 스킵
   - 대상 design 파일에서 `## 검수 이력` 섹션을 `{task_id}.review.md`로 추출
   - 원본 design 파일에서 `## 검수 이력` 섹션 제거
8. **archive 정리** (v3.4.1):
   - `.forge-flow/archive/` 디렉토리 존재 시 삭제
9. **프로젝트 검증 관점 섹션 추가** (v3.4.3):
   - CLAUDE.md `<!-- SECTION: 에이전트팀 -->` 내에 `### 프로젝트 검증 관점 (선택)` 섹션이 없으면 빈 테이블로 자동 추가
   - 이미 존재하면 스킵 (사용자 커스텀 보존)

### 4단계: 결과 보고

```
[update 완료] v{이전버전} → v{최신버전}

[훅 정리]
  🗑️ 프로젝트별 hooks 블록 제거됨
  🗑️ 기존 .claude/hooks/*.sh 정리됨 (해당 시)
  ✅ 글로벌 훅 확인 — ~/.claude/forge-flow-hooks/
  ✅ CLAUDE.md 버전 마커 — {최신버전}

[v3.4.1 마이그레이션]
  ✅ rework-log 차원 태그 — {N}건 [코드] 태그 부여 (해당 시)
  ✅ 검수 이력 분리 — {N}개 design → .review.md 분리 (해당 시)
  🗑️ archive 디렉토리 — 정리됨 (해당 시)

⏭️ 프로젝트 설정 — 보존됨
```

### update 범위 규칙 (중요)

**update가 건드리는 것**:
- 버전 마커
- `<!-- SECTION: 작업 원칙 -->` 섹션
- `<!-- SECTION: 워크플로 -->` 섹션
- `settings.local.json` / `settings.json` (프로젝트) hooks 블록 제거 (글로벌 이전)
- `<!-- SECTION: 에이전트팀 -->` 섹션 (필수화)
- 프로젝트에 복사된 기존 `.claude/hooks/*.sh` 삭제 (마이그레이션)
- `.forge-flow/rework-log.md` 차원 태그 마이그레이션 (v3.4.1)
- `.forge-flow/design/` 검수 이력 분리 마이그레이션 (v3.4.1)
- `.forge-flow/archive/` 삭제 (v3.4.1)
- `### 프로젝트 검증 관점` 빈 테이블 추가 (v3.4.3, 미존재 시에만)

**update가 절대 건드리지 않는 것**:
- `<!-- SECTION: 빌드 명령 -->` — 프로젝트 커스텀
- `<!-- SECTION: 변경 전파 체인 -->` — 프로젝트 커스텀
- `<!-- SECTION: 브랜치 전략 -->` — 프로젝트 커스텀
- `### 프로젝트 검증 관점` 테이블 내용 — 프로젝트 커스텀 (존재하면 보존)
- SECTION 마커 없는 프로젝트 고유 섹션 (MCP 원칙, 기술 스택 등)

미정이었던 항목(빌드/테스트 명령) 재수집도 이 옵션으로 처리.

---

## --reset 흐름

```
1. .forge-flow/design/ 보존 여부 확인
2. 전체 제거:
   - settings.local.json / settings.json hooks 블록 제거
   - .forge-flow/ 삭제
   - CLAUDE.md 워크플로 섹션 제거
   - 기존 .claude/hooks/*.sh 삭제 (있으면)
3. 1단계부터 재시작
```

---

## --purge 흐름

```
1. "forge-flow를 완전히 제거합니다. 계속하시겠습니까?" 확인
2. 제거 대상:
   - settings.local.json hooks 블록 제거
   - settings.json hooks 블록 제거 (에이전트팀 설정 포함)
   - .forge-flow/ 삭제
   - CLAUDE.md 워크플로 섹션 제거 (SECTION 마커 기반)
   - 기존 .claude/hooks/*.sh 삭제 (있으면, 마이그레이션 잔여)
3. .forge-flow/design/ 보존 여부 확인 (사용자 데이터)
```

### --purge --global 추가 옵션

`--purge --global` 실행 시 프로젝트 제거에 더해:
- `~/.claude/forge-flow-hooks/` 디렉토리 삭제
- `~/.claude/settings.json`에서 forge-flow hooks 블록 제거

> 주의: 다른 프로젝트에서 forge-flow를 사용 중이면 해당 프로젝트의 훅도 비활성화됩니다.
