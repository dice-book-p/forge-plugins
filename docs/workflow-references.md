# 워크플로 플러그인 레퍼런스 모음

> 작성일: 2026-03-13
> 목적: forge-flow v2 설계 시 참고할 외부 구현체 및 패턴 정리

---

## Tier 1 — 핵심 참고 대상

### 1. Superpowers (obra/superpowers)

- **URL**: https://github.com/obra/superpowers
- **구조**: brainstorm → spec → git worktree → plan → TDD (RED-GREEN-REFACTOR)
- **핵심 패턴**:
  - spec 작성 후 사용자 검증 없이 코드 작성 금지
  - 설계를 소화 가능한 단위로 나눠 사용자에게 제시
  - git worktree로 격리된 작업 환경
  - TDD 강제
- **forge-flow 참고점**: spec-first 접근, worktree 격리 패턴

### 2. Deep Trilogy (piercelamb/deep-plan, deep-project, deep-implement)

- **URL**: https://github.com/piercelamb/deep-plan
- **블로그**: https://pierce-lamb.medium.com/building-deep-plan-a-claude-code-plugin-for-comprehensive-planning-30e0921eb841
- **구조**: /deep-project (아이디어 → 컴포넌트 분해) → /deep-plan (리서치 + 인터뷰 → 상세 계획, 멀티 LLM 리뷰) → /deep-implement (TDD + 코드 리뷰 + git)
- **핵심 패턴**:
  - 요구사항 명확화에 5-10개 질문
  - 외부 LLM(Gemini/OpenAI)으로 교차 검증
  - 서브에이전트 폴백 (외부 LLM 없을 때)
- **forge-flow 참고점**: 멀티 LLM 교차검증 아이디어 (서브에이전트로 대체 가능), 질문 기반 요구사항 명확화

### 3. claude-code-spec-workflow (Pimzino)

- **URL**: https://github.com/Pimzino/claude-code-spec-workflow
- **MCP 버전**: https://github.com/Pimzino/spec-workflow-mcp
- **구조**: Requirements → Design → Tasks → Implementation / Bug: Report → Analyze → Fix → Verify
- **핵심 패턴**:
  - Steering documents로 프로젝트 컨텍스트 관리
  - MCP 서버 버전으로 진화 중 (실시간 대시보드, VSCode 확장)
- **forge-flow 참고점**: 버그 수정 전용 워크플로 분기

### 4. shinpr/claude-code-workflows

- **URL**: https://github.com/shinpr/claude-code-workflows
- **구조**: Analyze → Design → Plan → Implement → Verify (각 단계별 전문 에이전트)
- **핵심 패턴**:
  - **각 단계를 fresh agent context에서 실행** — 긴 컨텍스트로 인한 품질 저하 방지
  - 전문 에이전트: requirement-analyzer, technical-designer, work-planner, task-executor
  - AC를 설계에서 테스트까지 추적
- **forge-flow 참고점**: 단계별 fresh context 패턴 (서브에이전트와 유사), AC 추적 체계

### 5. levnikolaevich/claude-code-skills

- **URL**: https://github.com/levnikolaevich/claude-code-skills
- **구조**: bootstrap → docs → epic/story 분해 → task 실행 + review loop → quality gate
- **핵심 패턴**:
  - **4단계 품질 게이트**: PASS / CONCERNS / REWORK / FAIL
  - 멀티 모델 리뷰 (OpenAI Codex/Gemini + Claude Opus 폴백)
  - 사용자 승인 체크포인트 (story 검증, 품질 게이트)
- **forge-flow 참고점**: 4단계 품질 게이트 체계, 사용자 승인 포인트 설계

---

## Tier 2 — 추가 참고

### 6. catlog22/Claude-Code-Workflow

- **URL**: https://github.com/catlog22/Claude-Code-Workflow
- JSON 기반 멀티 에이전트 프레임워크, 4가지 워크플로 레벨 (instant → lite-plan → plan/tdd-plan → brainstorm+auto-parallel)
- **참고점**: 작업 규모별 워크플로 분기 (S/M/L과 유사)

### 7. wshobson/agents

- **URL**: https://github.com/wshobson/agents
- 112개 전문 에이전트, 16개 오케스트레이터, 146개 스킬
- **참고점**: 가설 기반 디버깅 (3개 경쟁 가설 병렬 조사), 파일 소유권 기반 작업 분배

---

## Ralph-Loop 분석

### 개요

- **원본**: Geoffrey Huntley의 자율 개발 루프 기법 (https://ghuntley.com/loop/)
- **구현체**: frankbria/ralph-claude-code (https://github.com/frankbria/ralph-claude-code)
- **공식**: anthropic claude-code 레포의 plugins/ralph-wiggum/

### 핵심 메커니즘

- **Dual-condition exit gate**: 완료 지표 2개 이상 + Claude의 명시적 EXIT_SIGNAL 모두 충족해야 루프 종료
- **Fresh context**: 매 반복마다 새 컨텍스트로 시작 (컨텍스트 오염 방지)
- **Rate limiting**: 100 API 호출/시간
- **Circuit breaker**: 3회 연속 진전 없음 또는 5회 동일 에러 시 쿨다운

### 세션 격리 문제 (Issue #26514)

**핵심 문제**: `.claude/ralph-loop.local.md`가 프로젝트 루트에 공유 파일로 존재.

- 터미널 A에서 ralph-loop 실행 중 → 터미널 B에서 대화형 세션 열면:
  - Stop 훅이 터미널 B에서도 발동
  - 공유 상태 파일의 `active: true`를 보고 B에도 ralph-loop 프롬프트 주입
  - A의 반복 예산을 B가 소모
  - B의 컨텍스트가 오염

**수정 방향** (PR #606, 2026-03-12):
- 세션 ID 기반 파일명: `.claude/ralph-loop-<session-id>.local.md`
- `CLAUDE_CODE_SESSION_ID` 환경변수 스코핑
- Stop 훅에 소유권 확인 추가

### forge-flow에 적용할 교훈

1. **상태 파일은 반드시 세션 스코프** — `${CLAUDE_SESSION_ID}` 활용
2. **Dual-condition exit gate** — 기계적 판단 + Claude 판단 조합
3. **Fresh context 패턴** — 서브에이전트로 구현 가능
4. **Circuit breaker** — 무한 루프 방지 필수

---

## 핵심 아키텍처 패턴 요약

| 패턴 | 출처 | forge-flow 적용 |
|------|------|----------------|
| Spec-first (코드 전 spec 필수) | Superpowers | clarify → design 문서 필수 |
| Phase isolation (단계별 fresh context) | shinpr | 서브에이전트로 교차검증 |
| Multi-LLM 교차검증 | Deep Trilogy | 서브에이전트 독립 검수로 대체 |
| 4단계 품질 게이트 | levnikolaevich | PASS/CONCERNS/REWORK/FAIL 도입 검토 |
| Dual-condition exit | Ralph | verify에서 기계적 + 논리적 조건 모두 충족 필수 |
| 세션 스코프 상태 관리 | Ralph (교훈) | `${CLAUDE_SESSION_ID}` 기반 상태 파일 |
| 작업 규모별 워크플로 분기 | catlog22 | S/M/L 분기 |
| TDD 강제 | Superpowers | 옵션 — 프로젝트에 따라 |
| Git worktree 격리 | Superpowers, Ralph | 교차검증 + 병렬 작업 |

---

## Awesome Lists

- https://github.com/ccplugins/awesome-claude-code-plugins
- https://github.com/ComposioHQ/awesome-claude-plugins
- https://github.com/hesreallyhim/awesome-claude-code
- https://github.com/ComposioHQ/awesome-claude-skills

## 한국 커뮤니티

- revfactory/claude-code-mastering — 13장 한국어 가이드북 (https://github.com/revfactory/claude-code-mastering)
- revfactory/claude-code-guide — 바이브 코딩 가이드 (https://github.com/revfactory/claude-code-guide)
- 공식 한국어 문서: https://code.claude.com/docs/ko/plugins
