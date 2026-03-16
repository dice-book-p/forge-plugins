# forge-flow 개발자 가이드

플러그인 구조, 확장 방법, 기여 가이드입니다.

---

## 1. 플러그인 구조

```
forge-flow/
├── .claude-plugin/
│   └── plugin.json                      # 플러그인 매니페스트
├── skills/
│   ├── clarify/SKILL.md                 # 요구사항 명확화
│   ├── review-req/SKILL.md              # 요구사항 교차검증
│   ├── plan/SKILL.md                    # 구현 계획 설계
│   ├── review-plan/SKILL.md             # 설계 검수 (조건부)
│   ├── verify/SKILL.md                  # 작업 종합 검수
│   ├── build-check/SKILL.md             # 빌드 검증 (내부)
│   ├── fe-check/SKILL.md                # FE 검증 (내부)
│   └── install/
│       ├── SKILL.md                     # 설치/업그레이드/제거
│       ├── hooks/                       # 프로젝트에 복사될 훅 스크립트
│       │   ├── stop-guard.sh
│       │   ├── workflow-state.sh
│       │   └── dangerous-cmd-guard.sh
│       ├── scripts/
│       │   └── analyze-project.py       # 프로젝트 분석 (레거시, 참고용)
│       └── templates/
│           └── claude-md-sections-v2.md # CLAUDE.md 템플릿
```

### 글로벌 vs 프로젝트별

| 구분 | 위치 | 역할 |
|------|------|------|
| **플러그인 (글로벌)** | `~/.claude/plugins/` 등록 | 스킬 정의, 훅 원본, 템플릿 |
| **프로젝트 설치물** | 각 프로젝트 루트 | `.claude/hooks/`, `design/`, `.forge-flow/`, CLAUDE.md 섹션 |

플러그인의 SKILL.md를 수정하면 모든 프로젝트에 즉시 반영됩니다.
훅 스크립트와 CLAUDE.md 섹션은 프로젝트에 복사된 것이므로 `--update`로 갱신합니다.

---

## 2. 핵심 개념

### 2.1 상태 파일

```json
// .forge-flow/state-${CLAUDE_SESSION_ID}.json
{
  "session_id": "abc123",
  "phase": "implementing",
  "design_file": "design/login-feature.md",
  "scale": "M",
  "stop_count": 0,
  "started_at": "2026-03-13T10:00:00Z"
}
```

- 세션별로 독립 관리 (`CLAUDE_SESSION_ID` 기반)
- `.forge-flow/`는 `.gitignore` 대상
- `stop_count`: 종료 차단 횟수 (circuit breaker용)

### 2.2 Phase 전이

```
clarifying → reviewing-req → planning → reviewing-plan(조건부) → implementing → verifying → verified → completed
```

전진 전이 시 `stop_count`를 0으로 리셋합니다.
후퇴 전이(FAIL/REWORK) 시에는 리셋하지 않습니다.

### 2.3 설계 문서

`design/{작업명}.md` — 워크플로의 단일 진실 원천(single source of truth).

각 스킬이 설계 문서의 특정 섹션을 읽고 씁니다:
- **clarify**: 전체 생성
- **review-req**: `## 검수 결과`, `## 검수 이력` 추가
- **plan**: `## 구현 계획` 추가
- **review-plan**: `## 검수 결과` 갱신
- **verify**: `## 검수 결과`, `## 검수 이력` 갱신

### 2.4 4단계 품질 게이트

모든 검수 스킬이 공유하는 판정 체계:

```
PASS       → 다음 단계
CONCERNS   → 사용자 판단
REWORK     → 재작업 (3회 → FAIL 에스컬레이션)
FAIL       → 이전 단계로 후퇴
```

### 2.5 워크플로 강제 4계층

```
1. Skills 2.0 description — 자연어 트리거로 자동 진입
2. UserPromptSubmit 훅   — 매 프롬프트에 상태 컨텍스트 주입
3. CLAUDE.md 규칙        — "clarify 없이 구현 금지" 등
4. Stop 훅               — 미완료 시 종료 차단
```

---

## 3. SKILL.md 작성법

### 3.1 Frontmatter

```yaml
---
name: skill-name
description: "스킬 설명. 자동 트리거 키워드를 포함하면 Skills 2.0이 매칭합니다."
user-invocable: true   # false면 내부 전용 (다른 스킬에서만 호출)
allowed-tools: Bash, Read  # 선택사항. 허용할 도구 제한
argument-hint: "[arg]"     # 선택사항. 인수 힌트
---
```

### 3.2 자동 트리거

`description`에 트리거 키워드를 포함하면 사용자가 명시적으로 호출하지 않아도 자동 활성화됩니다.

예시:
```yaml
description: "구현 착수 전 요구사항을 명확한 스펙으로 변환합니다. '추가', '수정', '만들어', '구현' 등의 요청에 자동 활성화."
```

### 3.3 내부 스킬

`user-invocable: false`로 설정하면 사용자가 직접 호출할 수 없고, 다른 스킬 내에서만 호출됩니다.

```yaml
user-invocable: false
```

현재 내부 스킬: `build-check`, `fe-check`

---

## 4. 훅 개발

### 4.1 훅 타입별 입출력

| 훅 타입 | stdin | 허용 stdout |
|---------|-------|------------|
| **UserPromptSubmit** | 프롬프트 정보 | `{"additionalContext": "..."}` |
| **Stop** | `{"stop_hook_active": bool}` | `{"decision": "block", "reason": "..."}` |
| **PreToolUse** | `{"tool_name": "...", "tool_input": {...}}` | `{"permissionDecision": "deny", "reason": "..."}` |

빈 stdout = 허용/통과.

### 4.2 jq + python3 폴백 패턴

```bash
if command -v jq >/dev/null 2>&1; then
  # jq 구현 (빠름)
  FIELD=$(echo "$INPUT" | jq -r '.field // ""' 2>/dev/null)
else
  # python3 폴백
  FIELD=$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('field',''))" <<< "$INPUT" 2>/dev/null)
fi
```

모든 훅 스크립트는 이 패턴을 사용합니다.
외부 의존성 없이 macOS/Linux 기본 환경에서 동작합니다.

### 4.3 Circuit Breaker

stop-guard.sh의 무한 루프 방지:

```
stop_count를 매 차단 시 +1
stop_count >= 3이면 강제 통과 + count 리셋
```

이 패턴은 사용자가 정말로 종료하고 싶을 때 3회 시도로 탈출할 수 있게 합니다.

### 4.4 settings.local.json 등록

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "bash .claude/hooks/workflow-state.sh" }]
    }],
    "Stop": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "bash .claude/hooks/stop-guard.sh" }]
    }],
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "bash .claude/hooks/dangerous-cmd-guard.sh" }]
    }]
  }
}
```

---

## 5. 템플릿

### 5.1 CLAUDE.md 템플릿

`templates/claude-md-sections-v2.md`에 플레이스홀더를 사용합니다.

| 플레이스홀더 | 치환 값 |
|------------|--------|
| `{BUILD_COMMANDS_TABLE}` | 감지된 빌드 명령 테이블 |
| `{CHANGE_PROPAGATION_TABLE}` | 모노레포 전파 체인 또는 "없음" |
| `{BASE_BRANCH}` | 기준 브랜치 (main, develop 등) |
| `{BRANCH_PATTERN}` | 기능 브랜치 패턴 (feature/*, feat/* 등) |
| `{AGENT_TEAMS_SECTION}` | 에이전트팀 섹션 (비활성 시 빈 문자열) |

install 스킬이 프로젝트 정보를 수집한 후 플레이스홀더를 치환하여 CLAUDE.md에 삽입합니다.

### 5.2 버전 마커

```html
<!-- forge-flow:version=3.0.0 -->
```

CLAUDE.md에 삽입되며, `--update` 시 버전 비교에 사용됩니다.

---

## 6. 서브에이전트 교차검증

review-req, verify에서 사용하는 독립 검증 방식:

```
Agent tool + isolation: "worktree"
→ 메인 세션과 독립된 코드 복사본에서 검증
→ 편향 없는 결과
```

서브에이전트 프롬프트에는 설계 문서와 검증 기준을 포함하며,
메인 세션의 컨텍스트와 분리하여 독립적 판단을 유도합니다.

---

## 7. 새 스킬 추가하기

1. `skills/{스킬명}/SKILL.md` 생성
2. frontmatter 작성 (name, description 필수)
3. `.claude-plugin/plugin.json`의 `skills` 경로가 `./skills/`이므로 자동 발견됨
4. 상태 전이가 필요하면 phase 추가 및 관련 스킬에서 전이 로직 수정

### 체크리스트

- [ ] SKILL.md frontmatter 완성
- [ ] 상태 파일 phase 전이 정의
- [ ] 설계 문서 읽기/쓰기 섹션 명시
- [ ] 품질 게이트 적용 여부 결정
- [ ] workflow-state.sh에 새 phase의 case 추가
- [ ] install SKILL.md의 스킬 목록 갱신

---

## 8. 테스트

### 8.1 훅 단위 테스트

```bash
# stop-guard 테스트 (차단 케이스)
echo '{"stop_hook_active": true}' | \
  CLAUDE_SESSION_ID=test bash .claude/hooks/stop-guard.sh

# workflow-state 테스트
echo '{}' | \
  CLAUDE_SESSION_ID=test bash .claude/hooks/workflow-state.sh

# dangerous-cmd-guard 테스트
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}' | \
  bash .claude/hooks/dangerous-cmd-guard.sh
```

### 8.2 통합 테스트

1. 테스트 프로젝트에서 `/forge-flow:install` 실행
2. 전체 워크플로 1회 순환: clarify → review-req → plan → 구현 → verify
3. 검증 항목:
   - 상태 파일이 올바르게 전이되는가
   - 설계 문서에 모든 섹션이 작성되는가
   - 검수 판정이 적절한가
   - 종료 차단이 동작하는가
   - circuit breaker가 3회 차단 후 해제되는가

### 8.3 플러그인 검증

```bash
claude plugin validate /path/to/forge-flow
```

---

## 9. 버전 관리

### 버전 업데이트 시 변경 대상

1. `.claude-plugin/plugin.json` — `version` 필드
2. `templates/claude-md-sections-v2.md` — `forge-flow:version=X.X.X` 마커
3. `install/SKILL.md` — 설치 완료 메시지의 버전 표기

### 프로젝트 업그레이드

플러그인 버전 업데이트 후 각 프로젝트에서:

```
/forge-flow:install --update
```

CLAUDE.md의 버전 마커와 비교하여 변경분만 패치합니다.

---

## 10. 설계 원칙

1. **플러그인 = 글로벌 (보편), install = 프로젝트별 (맞춤)**
2. **MCP/기술스택/환경에 의존하지 않음** — 어떤 프로젝트에서든 동작
3. **에이전트팀은 규모가 아닌 병렬성 기반** — 독립 모듈이 있을 때만 제안
4. **완성도 > 속도 > 토큰 효율** — 품질 게이트를 건너뛰지 않음
5. **증거 기반 판정** — 규모, 리스크 등은 파일 경로/코드 인용으로 근거 제시
