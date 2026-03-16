---
name: setup-workflow
description: "forge-flow 워크플로를 프로젝트에 설치합니다."
---

# /forge-flow:setup-workflow  `v3.1.4`

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
  4.2 hooks 등록 (루트 + 모노레포 서브프로젝트 각각)
  4.3 디렉토리 생성 (루트)
  4.4 훅 스크립트 복사 (루트 + 모노레포 서브프로젝트 각각)
  4.5 조건부 설정
  4.6 .gitignore 업데이트 (루트)
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

**서브프로젝트 목록 확인**: 감지된 서브프로젝트를 사용자에게 확인
```
[모노레포 감지]
  서브프로젝트:
    - namdo_market/        (build.gradle)
    - namdo_market_fe/     (package.json)
    - namdo_market_bff/    (build.gradle)
    - namdo_market_auth/   (build.gradle)
  훅을 각 서브프로젝트에도 설치합니다. 맞나요? [Y/n]
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
에이전트팀 기능을 활성화할까요? (병렬 가능 시 구현 + 리뷰어) [y/N]
```

- **활성화 시**: settings.local.json에 환경변수 주입, plan에서 병렬 가능 시 에이전트팀 제안
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

**훅 경로는 CWD 기준 상대경로입니다.** Claude를 어느 디렉토리에서 열든 해당 디렉토리의 `.claude/hooks/`에서 스크립트를 찾습니다.

따라서 **훅 등록 + 스크립트 복사는 아래 모든 위치에 수행**합니다:

```
[단일 레포]
  {프로젝트루트}/.claude/settings.local.json  ← hooks 등록
  {프로젝트루트}/.claude/hooks/*.sh           ← 스크립트 복사

[모노레포]
  {루트}/.claude/settings.local.json          ← hooks 등록
  {루트}/.claude/hooks/*.sh                   ← 스크립트 복사
  {서브프로젝트A}/.claude/settings.local.json  ← hooks 등록
  {서브프로젝트A}/.claude/hooks/*.sh           ← 스크립트 복사
  {서브프로젝트B}/.claude/settings.local.json  ← hooks 등록
  {서브프로젝트B}/.claude/hooks/*.sh           ← 스크립트 복사
  ... (감지된 모든 서브프로젝트)
```

`settings.local.json` 훅 블록 형식:
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

### 4.3 디렉토리 생성 (루트만)

```bash
mkdir -p .forge-flow/design/   # 작업별 설계 문서
mkdir -p .forge-flow/          # 세션별 상태 파일
```

> **모노레포도 루트에만**: `.forge-flow/`(설계 문서 + 상태 파일)는 어느 서브프로젝트에서 Claude를 열어도 동일하게 루트 기준으로 동작합니다. 워크플로 상태와 설계 문서는 레포 전체에서 하나의 위치에 집중.

### 4.4 훅 스크립트 복사

이 스킬의 `hooks/` 디렉토리(이 SKILL.md와 같은 레벨의 `hooks/` 폴더)에서 각 대상 경로의 `.claude/hooks/`로 **파일을 읽어서 그대로 복사**합니다.

**중요**: 훅 스크립트를 직접 작성하지 않습니다. 반드시 `hooks/` 디렉토리의 원본 파일을 Read로 읽고 Write로 복사합니다.

```bash
# 소스 경로 (이 스킬의 hooks/ 디렉토리)
HOOK_SRC="<이 SKILL.md가 위치한 디렉토리>/hooks"

# 복사 대상 스크립트
# - ${HOOK_SRC}/stop-guard.sh
# - ${HOOK_SRC}/workflow-state.sh
# - ${HOOK_SRC}/dangerous-cmd-guard.sh

# [단일 레포] → {루트}/.claude/hooks/
# [모노레포] → {루트}/.claude/hooks/ + 각 서브프로젝트/.claude/hooks/
```

각 경로에 `chmod +x .claude/hooks/*.sh` 실행.

> 훅 스크립트는 `jq` 사용을 우선하며, 미설치 시 `python3`으로 자동 폴백합니다. 별도 설치 없이 동작합니다.

### 4.5 조건부 설정

| 조건 | 설정 |
|------|------|
| FE 프로젝트 감지 | fe-check 활성화 (CLAUDE.md에 FE 빌드 명령 추가) |
| 에이전트팀 활성화 | 루트 `settings.local.json`에 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 환경변수 주입 |

### 4.6 .gitignore 업데이트 (루트만)

```bash
# 루트 .gitignore에 추가
.forge-flow/
```

> `.forge-flow/` 전체가 gitignore 대상 (설계 문서 + 상태 파일 모두 포함).

---

## 5단계: 검증 + 결과 보고

| 검증 항목 | 확인 방법 |
|----------|---------|
| CLAUDE.md 마커 | `forge-flow:version=X.X.X` 존재 확인 (루트) |
| CLAUDE.md 워크플로 섹션 | `/forge-flow:clarify`, `/forge-flow:verify` 등 스킬명 포함 |
| 루트 훅 스크립트 | `{루트}/.claude/hooks/stop-guard.sh` 존재 + 실행 권한 |
| 루트 settings 훅 | `{루트}/.claude/settings.local.json` hooks 키 존재 |
| 서브프로젝트 훅 | 각 서브프로젝트 `.claude/hooks/*.sh` 존재 + 실행 권한 |
| design 디렉토리 | `{루트}/.forge-flow/design/` 존재 |
| .forge-flow 디렉토리 | `{루트}/.forge-flow/` 존재 |
| [에이전트팀] 환경변수 | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 설정 확인 |

결과 보고 형식:
```
forge-flow v3.1.4 설치 완료

[루트 설치 항목]
  ✅ CLAUDE.md      — 워크플로 섹션 + 브랜치 전략 + 빌드 명령
  ✅ hooks          — Stop + UserPromptSubmit + PreToolUse
  ✅ .forge-flow/   — 설계 문서 + 세션별 상태 파일 디렉토리

[서브프로젝트 훅 설치] (모노레포인 경우)
  ✅ namdo_market/       — .claude/hooks/ 설치 완료
  ✅ namdo_market_fe/    — .claude/hooks/ 설치 완료
  ✅ namdo_market_bff/   — .claude/hooks/ 설치 완료
  ✅ namdo_market_auth/  — .claude/hooks/ 설치 완료

[워크플로 순서]
  /forge-flow:clarify → /forge-flow:review-req → /forge-flow:plan
  → (조건부) /forge-flow:review-plan → 구현 → /forge-flow:verify → 커밋

[스킬 목록]
  /forge-flow:clarify      요구사항 명확화 (자동)
  /forge-flow:review-req   요구사항 교차검증 (자동)
  /forge-flow:plan         구현 계획 설계 (자동)
  /forge-flow:review-plan  설계 검수 (조건부)
  /forge-flow:verify       작업 종합 검수 (자동)
  /forge-flow:build-check  빌드 검증 (verify 내부)
  /forge-flow:fe-check     FE 검증 (verify 내부, FE 프로젝트만)
```

---

## --update 흐름

### 1단계: 버전 비교

CLAUDE.md의 `<!-- forge-flow:version=X.X.X -->` 마커와 플러그인 버전 비교:
- 동일하면 → "이미 최신 버전입니다 (vX.X.X)" 출력 후 종료
- 다르면 → 2단계로 진행

### 2단계: 변경 사항 분석 + 리포트

update를 실행하기 전, 변경될 내용을 사용자에게 **먼저 보고**합니다.

**변경 내용 파악 방법**:
1. 이 플러그인의 `CHANGELOG.md` 파일을 읽어 현재 프로젝트 버전 ~ 최신 버전 사이의 모든 변경 항목을 수집
2. 수집한 변경 항목을 기반으로 리포트 생성
3. 모노레포 여부 재감지 (설치 이후 서브프로젝트가 추가됐을 수 있음)

**리포트 형식**:
```
[forge-flow update] v{현재버전} → v{최신버전}

[변경 예정 항목] (CHANGELOG.md 기반)
  {CHANGELOG에서 해당 버전 범위의 변경 항목을 나열}

[훅 스크립트 비교] (플러그인 최신본과 내용 diff)
  루트:
    ✅ .claude/hooks/workflow-state.sh      — 최신 / 🔄 갱신 필요
    ✅ .claude/hooks/stop-guard.sh          — 최신 / 🔄 갱신 필요
    ✅ .claude/hooks/dangerous-cmd-guard.sh — 최신 / 🔄 갱신 필요
  서브프로젝트:
    ✅/🔄 {서브프로젝트A}/.claude/hooks/ — 파일별 내용 비교 결과
    ✅/🔄 {서브프로젝트B}/.claude/hooks/ — 파일별 내용 비교 결과
    🆕 {서브프로젝트C}/.claude/hooks/    — 신규 감지, 새로 설치

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

1. **훅 스크립트 덮어쓰기**: 이 스킬의 `hooks/` 디렉토리 원본 파일을 Read로 읽고 Write로 복사 → 모든 대상 경로의 `.claude/hooks/`에 적용 (직접 작성 금지)
   - **루트 + 감지된 모든 서브프로젝트에 동일하게 적용** (존재 여부 무관)
   - 각 위치별로 **파일 내용 diff 비교** → 다르면 복사(갱신), 같으면 스킵
   - diff는 플러그인 `hooks/` 파일과 대상 경로 파일을 직접 비교 (`diff -q` 활용)
   - 실행 권한 설정 (`chmod +x`)
   - 신규 감지된 서브프로젝트는 `settings.local.json` hooks 블록도 추가
2. **CLAUDE.md 버전 마커 갱신**: `<!-- forge-flow:version=X.X.X -->` 교체
3. **CLAUDE.md 템플릿 섹션 갱신** (해당 시):
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

[서브프로젝트 훅] (내용 비교 기반)
  🔄 namdo_market_fe/  — 갱신됨  (또는 ⏭️ 내용 동일, 스킵)
  🔄 namdo_market/     — 갱신됨
  ⏭️ namdo_market_bff/ — 내용 동일, 스킵
  🆕 namdo_market_auth/— 신규 설치됨

⏭️ 프로젝트 설정 — 보존됨
```

### update 범위 규칙 (중요)

**update가 건드리는 것**:
- 버전 마커
- `<!-- SECTION: 작업 원칙 -->` 섹션
- `<!-- SECTION: 워크플로 -->` 섹션
- 루트 + 모든 서브프로젝트의 `.claude/hooks/` 3개 훅 스크립트

**update가 절대 건드리지 않는 것**:
- `<!-- SECTION: 빌드 명령 -->` — 프로젝트 커스텀
- `<!-- SECTION: 변경 전파 체인 -->` — 프로젝트 커스텀
- `<!-- SECTION: 브랜치 전략 -->` — 프로젝트 커스텀
- `<!-- SECTION: 에이전트팀 -->` — 프로젝트 커스텀
- SECTION 마커 없는 프로젝트 고유 섹션 (MCP 원칙, 기술 스택 등)
- 각 서브프로젝트의 기존 `settings.local.json` 내용 (hooks 블록 제외)

미정이었던 항목(빌드/테스트 명령) 재수집도 이 옵션으로 처리.

---

## --reset 흐름

```
1. .forge-flow/design/ 보존 여부 확인
2. 전체 제거 (루트 + 모든 서브프로젝트의 hooks, .forge-flow/, CLAUDE.md 워크플로 섹션)
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
3. 제거 대상 (모든 서브프로젝트):
   - {서브프로젝트}/.claude/hooks/stop-guard.sh, workflow-state.sh, dangerous-cmd-guard.sh
   - {서브프로젝트}/.claude/settings.local.json hooks 블록 제거 (나머지 보존)
4. .forge-flow/design/ 보존 여부 확인 (사용자 데이터)
```
