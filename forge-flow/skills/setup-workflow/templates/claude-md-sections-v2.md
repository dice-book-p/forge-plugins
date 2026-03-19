<!-- forge-flow:version=3.3.0 -->
<!-- SECTION: 작업 원칙 -->
## 작업 원칙

**확신이 없으면 절대 진행하지 않습니다.** 질문 비용 < 재작업 비용.

| 상황 | 조치 |
|------|------|
| 요구사항 해석 2가지+ | 구현 전 확인 |
| 변경 범위 불명확 | 범위 먼저 합의 |
| 구현 방식 선택 필요 | 옵션 제시 후 결정 |
| 서비스 간 영향 불명확 | 영향도 먼저 파악 |
| "혹시 이게 맞나?" 싶은 순간 | 즉시 멈추고 질문 |

**구현 전 자가 체크** — 아래 중 하나라도 해당되면 구현 전에 질문:
- 완료 후 어떻게 검증할지 지금 설명하기 어렵다
- 변경이 영향을 미치는 범위를 아직 다 파악하지 못했다
- 요구사항이 두 가지 이상으로 해석될 여지가 있다

<!-- SECTION: 워크플로 -->
## 워크플로

**사용자 요청 수신 → 아래 순서로 실행합니다. 각 단계는 예외 없음.**

| # | 액션 | 트리거 | 규모 |
|---|------|--------|------|
| 1 | `/forge-flow:clarify` | 작업 요청 즉시 | S/M/L |
| 2 | `/forge-flow:review-req` | clarify 완료 후 | S/M/L |
| 2.5 | **사용자 확인** | review-req 통과 후 | S/M/L |
| 3 | `/forge-flow:plan` | 사용자 승인 후 | S/M/L |
| 4 | `/forge-flow:review-plan` | plan 완료 후 (조건부) | L 필수, M 조건부 |
| 5 | 구현 | plan/review-plan 통과 후 | S/M/L |
| 6 | `/forge-flow:verify` | 구현 완료 즉시 | S/M/L |
| 7 | `/forge-flow:test` | verify 통과 후 | M/L (S 조건부) |
| 8 | `/forge-flow:complete` | test 통과/스킵 후 | S/M/L |

**규칙**:
- `/forge-flow:clarify` 없이 구현 착수 금지
- `/forge-flow:verify` + `/forge-flow:test` 합격 없이 작업 완료 선언 금지
- `.forge-flow/design/` 문서의 AC 항목을 모두 충족해야 작업 완료
- review-req 통과 후 **사용자 확인** → plan → implement → verify까지 자동 진행 (위험 작업 제외)

**상태 파일**: `.forge-flow/state/{task-id}.json` — 작업별 워크플로 단계 추적 (세션 간 재개 가능)

<!-- SECTION: 빌드 명령 -->
## 빌드 명령

{BUILD_COMMANDS_TABLE}

<!-- SECTION: 변경 전파 체인 -->
## 변경 전파 체인

{CHANGE_PROPAGATION_TABLE}

<!-- SECTION: 브랜치 전략 -->
## 브랜치 전략

| 항목 | 설정 |
|------|------|
| 기준 브랜치 | {BASE_BRANCH} |
| 기능 브랜치 패턴 | {BRANCH_PATTERN} |

- 특정 브랜치 지정 없으면 → 기준 브랜치에서 기능 브랜치 분기
- plan 단계에서 자동 분기: `{BRANCH_PATTERN}{작업명}`

<!-- SECTION: 에이전트팀 (선택) -->
{AGENT_TEAMS_SECTION}

<!-- 에이전트팀 활성화 시 {AGENT_TEAMS_SECTION}에 삽입할 내용:

## 에이전트팀

활성화 상태 (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`).

### 동적 팀 구성

팀은 매 작업마다 **동적으로** 구성됩니다. 사전 고정 역할은 없습니다.

- **구현 팀** (plan에서 구성): 독립 모듈/레이어별 구현자 + 리뷰어
- **검증 팀** (verify에서 구성): 관점별 검증자 (AC, 패턴)
- **테스트 팀** (test에서 구성): UI/UX 브라우저 테스트 + API 테스트 (sonnet 고정)

### 팀원 작업 규칙
- 담당 범위 외 파일 수정 금지
- 빌드 성공 확인 후 태스크 완료 보고
- 다른 팀원과의 인터페이스 변경 시 메시지로 사전 합의

### 리더 역할
- clarify ~ plan: 리더 단독
- 구현: 팀원 spawn + 모니터링 + 통합 머지
- verify: 검증 팀 spawn + 결과 취합 + 최종 판정

### 모델 사용 전략
| 작업 유형 | 모델 | 이유 |
|-----------|------|------|
| 분석/검증/플랜 (review-req, verify) | 세션 모델 상속 | 사용자가 선택한 모델 수준 유지 |
| 구현/문서작성 (implementer, reviewer) | sonnet 고정 | 명확한 지시 기반 실행, 속도+비용 최적 |
| 실행 테스트 (test 테스터) | sonnet 고정 | 브라우저/API 테스트는 지시 실행 중심, 비용 최적 |

-->
