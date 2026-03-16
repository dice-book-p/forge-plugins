# forge-flow Plugin — 설계 및 작업 정리

> 작성일: 2026-03-13
> 최종 업데이트: 2026-03-13
> 상태: 프로젝트 정리 완료, 플러그인 품질 개선 진행 예정

---

## 목표

`forge-flow`를 독립 Claude Code 플러그인으로 분리하여 모든 프로젝트에서 재사용 가능하게 만든다.

### 핵심 원칙

1. **`skill_memory/` 제거** — CLAUDE.md가 진실의 원천, 중복 파일 없음
2. **플러그인 단위 배포** — `claude plugin install` 한 번으로 모든 프로젝트에 적용
3. **스킬명 전환** — `/clarify` → `/forge-flow:clarify` (네임스페이스 명확화)
4. **동적 프로젝트 세팅** — `/forge-flow:install`이 CLAUDE.md를 프로젝트에 맞게 패치

---

## 플러그인 구조

```
/Users/dicepark/IdeaProjects/claude-tool-creator/
├── claude-plugins/
│   └── forge-flow/
│       ├── plugin.json
│       └── skills/
│           ├── install/         ← 설치 스킬 (스크립트 + 템플릿 포함)
│           │   ├── SKILL.md
│           │   ├── scripts/     ← install.sh, patch-*.py, loop-*.sh 등
│           │   └── templates/   ← claude-md-sections.md, agent-teams-guide.md
│           ├── clarify/SKILL.md
│           ├── verify/SKILL.md
│           ├── pre-check/SKILL.md
│           ├── build-check/SKILL.md
│           └── fe-check/SKILL.md
└── docs/
    └── forge-flow-plugin.md   ← 이 파일
```

---

## 스킬 개요

| 스킬 | 역할 | 트리거 |
|------|------|--------|
| `install` | 프로젝트 초기 세팅 (CLAUDE.md 패치, hooks, scripts) | 수동 (`/forge-flow:install`) |
| `clarify` | 요구사항 재진술 + AC 작성 → design/ 파일 생성 | 자동 (작업 시작 시) |
| `pre-check` | 구현 전 4단계 자가 체크 (설계검토, 리스크, 구현계획) | design/ 파일 생성 직후 |
| `verify` | 변경 후 2회 연속 검증 (1회: 기계적, 2회: 논리적) | 구현 완료 시 |
| `build-check` | 빌드 검증 (`## 빌드 명령` 참조) | verify 내부에서 호출 |
| `fe-check` | FE 타입체크 → 린트 → 빌드 순차 검증 | verify 내부에서 호출 |

### 워크플로 흐름

```
요청 수신
  → /forge-flow:clarify (요구사항 명확화 + AC 작성 → design/{작업명}.md)
  → /forge-flow:pre-check (설계검토 + 리스크 + 구현계획)
  → 구현 (loop-start.sh 루프)
  → /forge-flow:verify (2회 연속 검증)
    ├─ 1회차: build-check / fe-check (기계적)
    └─ 2회차: AC 대조 (논리적)
  → VERIFY_PASS=2 → <promise>DONE</promise> → 루프 종료
  → /simplify → 커밋
```

---

## 스킬별 CLAUDE.md 참조 섹션

| 스킬 | 참조하는 CLAUDE.md 섹션 |
|------|----------------------|
| `clarify` | `## Agent Teams 운영 가이드` → 팀 구성, 브랜치 접두사 |
| `verify` | `## 빌드 명령`, `## 작업 원칙` → MCP 활용 원칙 |
| `pre-check` | `## 빌드 명령`, `## 변경 전파 체인`, `## Agent Teams 운영 가이드` |
| `build-check` | `## 빌드 명령` |
| `fe-check` | `## 빌드 명령` |

---

## install 동작

### 실행되는 단계

1. `patch_claude_md()` — CLAUDE.md에 워크플로 섹션 삽입
2. `patch_settings()` — hooks + UserPromptSubmit 훅 설정
3. `copy_loop_scripts()` — `loop-start.sh`, `loop-cancel.sh`, `stop-hook.sh` → `.claude/scripts/`
4. `create_workspace()` — `.agent/workspace/` 디렉토리 생성 + AT 모드 시 agent-teams.md 생성

### 제거된 단계 (레거시)

- `install_skills()` — 플러그인 시스템이 스킬 배포를 담당
- `generate_skill_memory()` — `skill_memory/` 완전 제거

---

## 설치 방법 (완성 후)

```bash
# 로컬 경로로 설치
claude plugin install /Users/dicepark/IdeaProjects/claude-tool-creator/claude-plugins/forge-flow

# 각 프로젝트에서 초기 세팅
cd ~/projects/namdomarket && /forge-flow:install
cd ~/projects/primis && /forge-flow:install
```

---

## 완료된 작업

- [x] `plugin.json` 작성
- [x] 6개 SKILL.md 작성 (install, clarify, verify, pre-check, build-check, fe-check)
- [x] `templates/claude-md-sections.md` — `/forge-flow:*` 스킬명으로 업데이트
- [x] `scripts/install.sh` — install_skills/generate_skill_memory 호출 제거, copy_loop_scripts 추가
- [x] `scripts/patch-settings.py` — UserPromptSubmit 훅 forge-flow: 접두사
- [x] `install.sh` 내 `TEMPLATES_DIR` → `$SCRIPT_DIR/../templates` 경로 수정
- [x] `purge.sh` 내 `.claude/skills/` workflow 스킬 삭제 로직 제거
- [x] 6개 프로젝트 forge-flow 완전 정리 (폴더, 스크립트, CLAUDE.md 워크플로, settings, .agent)
  - namdomarket, safejeonnam, vasanta/primis, half-price-travel, jnitalk, ai-stack

---

## 플러그인 품질 개선 — 분석 결과 (다음 세션 작업)

### P1 — 핵심 문제 (워크플로 작동에 직접 영향)

#### 1. 스킬 자동 트리거 메커니즘 불명확
- `clarify`, `verify`가 "자동 트리거"라고 선언하지만 실제 자동화 로직이 없음
- UserPromptSubmit 훅은 스킬 목록을 컨텍스트에 주입할 뿐, 실행 강제 아님
- CLAUDE.md 워크플로 테이블이 "Skill 도구로 실행"이라고만 되어 있어 Claude 판단에 의존
- **해결 방향**: CLAUDE.md 워크플로 섹션에 명시적 트리거 조건 강화 또는 UserPromptSubmit 훅에 키워드 감지 로직 추가

#### 2. loop-start.sh 호출 책임 주체 불명
- pre-check 완료 후 누가 loop-start.sh를 호출하는가? (스킬? 사용자? Claude?)
- `--completion-promise DONE`의 작동 원리가 SKILL.md에 설명 없음
- **해결 방향**: pre-check SKILL.md 4단계에 "루프 시작" 명시적 섹션 추가

#### 3. verify `<promise>DONE</promise>` 출력 타이밍 모호
- VERIFY_PASS=2 달성 후 정확히 어느 시점에 출력하는지 불명확
- stop-hook.sh가 이를 감지하는 메커니즘도 설명 부족
- **해결 방향**: verify SKILL.md에 "완료 선언" 섹션에 정확한 출력 순서 명시

#### 4. install.sh 레거시 함수 잔재
- `install_skills()` (라인 82-137): 호출되지 않지만 함수 정의 남아있음
- `generate_skill_memory()` (라인 140-170): 호출되지 않지만 함수 정의 남아있음
- **해결 방향**: 두 함수 정의 제거

### P2 — 보완 사항 (사용성 개선)

#### 5. CLAUDE.md 참조 가이드 부족
- 각 스킬이 CLAUDE.md의 어떤 섹션을 어떤 형식으로 파싱해야 하는지 구체적 안내 없음
- **해결 방향**: 각 SKILL.md에 "CLAUDE.md 참조 가이드" 섹션 추가 (섹션명, 필드, 파싱 방법)

#### 6. AT 모드 팀원 소환 프로토콜 미구현
- clarify 0단계에서 AT 모드 결정은 있으나 TeamCreate 호출, 팀원별 역할 분배 로직이 스킬에 없음
- **해결 방향**: pre-check SKILL.md에 "AT 모드 팀원 소환" 섹션 추가

#### 7. design/ 파일 AC 작성 가이드 부족
- AC가 verify의 핵심 판단 기준인데, 좋은/나쁜 AC 예시 부족
- **해결 방향**: clarify SKILL.md에 AC 작성 가이드 보강 (검증 가능한 AC 예시)

#### 8. 변경 전파 체인 플레이스홀더 미충전
- `{BUILD_COMMANDS_TABLE}`, `{CHANGE_PROPAGATION_TABLE}` 플레이스홀더가 실제로 채워지는 로직 불완전
- **해결 방향**: patch-claude-md.py에 자동 생성 로직 추가 또는 install Q&A에서 수집

### P3 — 정리

#### 9. install Q&A 간소화
- 7개 질문 중 Q3(스택), Q7(MCP)은 analyze-project.py로 자동감지 가능
- **해결 방향**: 자동감지 항목은 "검토" 형태로 변경 (맞나요? Y/N)

#### 10. agent-teams-guide.md 길이 정리
- 100줄+ 템플릿에서 필수 vs 심화 구분 필요

---

## 남은 작업 요약

### 즉시 작업 (정리)

- [ ] install.sh 레거시 함수 제거 (`install_skills`, `generate_skill_memory` 정의 삭제)
- [ ] namdomarket CLAUDE.md `## Agent Teams 운영 가이드` 섹션 — `/clarify` → `/forge-flow:clarify`
- [ ] `git init` + `README.md` 작성

### 플러그인 품질 개선 (P1 → P2 → P3 순서)

- [ ] P1-1: clarify/verify 트리거 메커니즘 명확화
- [ ] P1-2: pre-check → loop-start.sh 호출 흐름 구체화
- [ ] P1-3: verify 완료 신호 + stop-hook 연동 명확화
- [ ] P2-5: 각 SKILL.md에 CLAUDE.md 참조 가이드 추가
- [ ] P2-6: AT 모드 팀원 소환 프로토콜 구현
- [ ] P2-7: AC 작성 가이드 보강
- [ ] P2-8: 변경 전파 체인 플레이스홀더 충전 로직
- [ ] P3-9: install Q&A 간소화
- [ ] P3-10: agent-teams-guide.md 정리

### 최종 단계

- [ ] 6개 프로젝트에서 `/forge-flow:install` 테스트
  - namdomarket, safejeonnam, vasanta/primis, half-price-travel, jnitalk, ai-stack

---

## 주요 파일 경로 참조

| 항목 | 경로 |
|------|------|
| 플러그인 루트 | `/Users/dicepark/IdeaProjects/claude-tool-creator/claude-plugins/forge-flow/` |
| install 스크립트 | `skills/install/scripts/install.sh` |
| CLAUDE.md 템플릿 | `skills/install/templates/claude-md-sections.md` |
| AT 가이드 템플릿 | `skills/install/templates/agent-teams-guide.md` |
| patch-claude-md.py | `skills/install/scripts/patch-claude-md.py` |
| patch-settings.py | `skills/install/scripts/patch-settings.py` |
| purge.sh | `skills/install/scripts/purge.sh` |
