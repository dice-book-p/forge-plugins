<!-- forge-flow:version=3.1.15 -->

## forge-flow 플러그인 버저닝 체크리스트

forge-flow 스킬 파일 변경 후 커밋·배포 시 **반드시 아래 항목을 모두 수행**합니다. 하나라도 누락하면 `--update` 버전 체크가 실패하거나 사용자에게 변경 이력이 전달되지 않습니다.

| # | 항목 | 파일 | 확인 |
|---|------|------|------|
| 1 | **plugin.json 버전 올리기** | `claude-plugins/forge-flow/.claude-plugin/plugin.json` | `"version": "X.Y.Z"` |
| 2 | **marketplace.json 버전 동기화** | `claude-plugins/.claude-plugin/marketplace.json` | plugin.json과 동일 버전 |
| 3 | **CHANGELOG.md 항목 추가** | `claude-plugins/forge-flow/CHANGELOG.md` | 최상단에 새 버전 섹션 추가 |
| 4 | **CLAUDE.md 버전 마커 갱신** | 루트 `CLAUDE.md` 1행 | `<!-- forge-flow:version=X.Y.Z -->` |
| 5 | **requires_update 갱신 (조건부)** | `plugin.json` + `clarify/SKILL.md` | 훅/CLAUDE.md 섹션 변경 시에만 갱신 |
| 6 | **커밋** | — | 위 파일 + 변경된 SKILL.md 모두 포함 |
| 7 | **마켓플레이스 배포** | — | `git subtree push --prefix=claude-plugins forge-plugins main` |

### CHANGELOG 작성 규칙

```markdown
## vX.Y.Z

- **feat/fix/change**: 변경 내용 한 줄 요약
  - 세부 사항 (필요 시)
- **affected**: 변경된 파일 목록
```

### 버전 번호 규칙

| 변경 유형 | 버전 올림 | 예시 |
|----------|----------|------|
| 스킬 로직 변경 / 기능 추가 | patch (Z++) | 3.1.9 → 3.1.10 |
| 워크플로 단계 추가·제거 | minor (Y++) | 3.1.x → 3.2.0 |
| 호환성 깨지는 변경 | major (X++) | 3.x.x → 4.0.0 |

### requires_update 규칙

`requires_update`는 **프로젝트에 설치된 파일(훅, CLAUDE.md 섹션)이 변경된 버전**을 가리킵니다. 사용자가 `--update`를 실행해야 반영되는 변경이 있을 때만 갱신합니다.

| 변경 대상 | requires_update 갱신 | 이유 |
|----------|:---:|------|
| 스킬 SKILL.md만 | **불필요** | 플러그인 소스에서 자동 로드 |
| 훅 스크립트 (workflow-state.sh 등) | **필수** | 프로젝트에 복사된 파일 → --update 필요 |
| CLAUDE.md 템플릿 섹션 (작업 원칙, 워크플로) | **필수** | 프로젝트에 패치된 내용 → --update 필요 |
| plugin.json 필드 추가 | **불필요** | 프로젝트에 복사되지 않음 |

**갱신 시 수정 위치** (2곳):
1. `plugin.json` → `"requires_update": "X.Y.Z"`
2. `clarify/SKILL.md` → `## 프로젝트 업데이트 확인` 섹션의 비교 값

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
| 8 | 커밋 | test 통과/스킵 후 | S/M/L |

**규칙**:
- `/forge-flow:clarify` 없이 구현 착수 금지
- `/forge-flow:verify` + `/forge-flow:test` 합격 없이 작업 완료 선언 금지
- `.forge-flow/design/` 문서의 AC 항목을 모두 충족해야 작업 완료
- review-req 통과 후 **사용자 확인** → plan → implement → verify까지 자동 진행 (위험 작업 제외)

**상태 파일**: `.forge-flow/state/state-${CLAUDE_SESSION_ID}.json` — 현재 워크플로 단계 추적

<!-- SECTION: 빌드 명령 -->
## 빌드 명령

| 대상 | 명령 |
|------|------|
| (미설정) | 이후 `--update`로 추가 |

<!-- SECTION: 변경 전파 체인 -->
## 변경 전파 체인

없음 (단일 레포)

<!-- SECTION: 브랜치 전략 -->
## 브랜치 전략

| 항목 | 설정 |
|------|------|
| 기준 브랜치 | main |
| 기능 브랜치 패턴 | feature/ |

- 특정 브랜치 지정 없으면 → 기준 브랜치에서 기능 브랜치 분기
- plan 단계에서 자동 분기: `feature/{작업명}`

<!-- SECTION: 에이전트팀 (선택) -->
