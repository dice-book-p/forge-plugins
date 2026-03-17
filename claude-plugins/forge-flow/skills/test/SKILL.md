---
name: test
description: "실행 테스트 — verify 통과 후 에이전트팀/서브에이전트로 브라우저 자동화(UI/UX) + API 테스트를 실제 실행하여 동작을 검증합니다. verify PASS 후 자동 트리거."
---

verify(코드 검증) 통과 후, 실제 런타임에서 동작을 검증합니다.
브라우저 자동화로 UI/UX를 테스트하고, API 엔드포인트를 호출하여 결과를 확인합니다.

## 선행 조건 검사

실행 전 반드시 확인:
1. 상태 파일 존재 → 없으면: "워크플로가 시작되지 않았습니다. `/forge-flow:clarify`로 시작하세요."
2. phase가 `"verified"` 또는 `"testing"`인지 확인 → 아니면: "현재 `{phase}` 단계입니다. verify를 먼저 통과하세요."
3. `design_file`이 존재하는 파일 경로인지 확인 → 없으면: "설계 문서를 찾을 수 없습니다."

## 상태 파일 갱신

실행 시작 시:
```json
{ "phase": "testing", "rework_count": 0 }
```

## 스킵 조건

아래 **모두** 해당하면 test를 스킵하고 바로 완료 처리합니다:
- 규모가 S
- design 문서에 UI/UX 관련 AC가 없음
- CLAUDE.md에 `## 테스트 환경` 섹션이 없음

스킵 시:
```
[test 스킵] S 규모 + UI/UX AC 없음 → 실행 테스트 불필요
```

## 테스트 범위 분석

design 문서의 AC 항목을 분석하여 테스트 유형을 결정합니다:

| AC 유형 | 테스트 방식 | 예시 |
|---------|-----------|------|
| UI 동작 | 브라우저 자동화 | "버튼 클릭 시 모달이 열린다" |
| 페이지 표시 | 브라우저 자동화 | "목록에 10개 항목이 표시된다" |
| API 응답 | API 직접 호출 | "POST /api/users → 201 반환" |
| 데이터 처리 | API + DB 확인 | "주문 생성 시 재고가 감소한다" |
| 폼 유효성 | 브라우저 자동화 | "이메일 형식 오류 시 에러 표시" |

## 테스트 실행 방식

### 단일 테스터 (기본)

테스터 에이전트를 spawn합니다 (`model: "sonnet"`):

```
Agent tool, subagent_type: "tester", model: "sonnet"
```

**테스터 프롬프트 템플릿**:
```
당신은 {프로젝트명}의 QA 테스터입니다.
구현된 기능을 실제로 실행하여 동작을 검증하세요.

## design 문서
{design 문서 전문}

## 테스트 대상 AC
{UI/UX 및 API 관련 AC 항목}

## 테스트 환경
{CLAUDE.md의 테스트 환경 정보 또는 프로젝트에서 파악한 정보}

## 테스트 방침
1. AC 항목별로 실제 동작을 확인합니다
2. 브라우저 자동화: 페이지 이동, 클릭, 입력, 결과 확인
3. API 테스트: 엔드포인트 호출, 응답 코드/바디 검증
4. 정상 경로 + 비정상 경로(에러 케이스) 모두 테스트
5. 스크린샷/응답 로그를 근거로 첨부

## 응답 형식
각 AC 항목에 대해:
- PASS: <실행 결과 근거>
- FAIL: <기대 동작 vs 실제 동작 + 스크린샷/로그>

## 종합 판정
PASS / FAIL + 근거
```

### 테스트 팀 (에이전트팀 활성화 시)

테스트 범위가 넓은 경우 (L 규모, 또는 도메인이 2개 이상) 테스트 팀을 구성합니다.

에이전트팀 활성화 조건 (모두 충족):
1. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 설정
2. 테스트 도메인이 2개 이상 (UI + API, 사용자단 + 관리자단 등)

> 에이전트팀 비활성화 시 또는 도메인 1개 → 단일 테스터(기본) 폴백.

#### 테스트 팀 구성 분석

design 문서의 AC를 분석하여 독립 테스트 도메인을 식별합니다:

| 분리 기준 | 예시 |
|----------|------|
| **도메인 분리** | 사용자단 UI 테스트 / 관리자단 UI 테스트 |
| **유형 분리** | 브라우저 UI 테스트 / API 통합 테스트 |
| **시나리오 분리** | 정상 플로우 / 에러·엣지케이스 플로우 |

#### 테스트 팀 구성 보고

```
[테스트 팀 구성]
  테스터 A: 사용자단 UI 플로우 — AC-1, AC-3 담당
  테스터 B: 관리자단 UI 플로우 — AC-2, AC-4 담당
  테스터 C: API 통합 테스트 — AC-5, AC-6 담당

테스트 팀을 구성합니다.
```

#### 테스터 spawn (각각 `model: "sonnet"`)

각 테스터에게 담당 AC와 테스트 범위만 전달합니다:

```
Agent tool, subagent_type: "tester", model: "sonnet"

당신은 {프로젝트명}의 QA 테스터입니다.
담당 영역: {담당 도메인/유형}

## design 문서
{design 문서 전문}

## 담당 테스트 AC
{이 테스터가 담당하는 AC 항목만}

## 테스트 환경
{CLAUDE.md의 테스트 환경 정보}

## 테스트 방침
1. 담당 AC 항목별로 실제 동작을 확인합니다
2. 브라우저 자동화: 페이지 이동, 클릭, 입력, 결과 확인
3. API 테스트: 엔드포인트 호출, 응답 코드/바디 검증
4. 정상 경로 + 비정상 경로(에러 케이스) 모두 테스트
5. 스크린샷/응답 로그를 근거로 첨부

## 응답 형식
각 AC 항목에 대해:
- PASS: <실행 결과 근거>
- FAIL: <기대 동작 vs 실제 동작 + 스크린샷/로그>

## 종합 판정
PASS / FAIL + 근거
```

> **핵심 원칙**: 테스터 간 결과를 공유하지 않음 (독립 테스트 보장).

#### 상태 파일 확장 (팀 활성화 시)

```json
{
  "phase": "testing",
  "agent_team": {
    "enabled": true,
    "members": [
      {"role": "tester", "scope": "사용자단 UI", "ac": ["AC-1", "AC-3"], "status": "active"},
      {"role": "tester", "scope": "관리자단 UI", "ac": ["AC-2", "AC-4"], "status": "active"},
      {"role": "tester", "scope": "API 통합", "ac": ["AC-5", "AC-6"], "status": "active"}
    ]
  }
}
```

## 결과 종합

**단일 테스터**:
- PASS → 작업 완료
- FAIL → 실패 항목 정리 → 수정 후 재테스트

**테스트 팀** (리더가 종합):
1. 모든 테스터의 결과 수집
2. AC × 테스터 매트릭스 작성
3. 실패한 테스터만 재실행 가능 (전체 재실행 불필요)
4. 최종 판정 도출

## 품질 게이트

| 등급 | 기준 | 조치 |
|------|------|------|
| **PASS** | 전 테스트 항목 통과 | 작업 완료 |
| **CONCERNS** | 경미한 UI 이슈 (스타일 미세 차이 등) | `AskUserQuestion`으로 판단 위임 |
| **REWORK** | AC 미충족 (기능 미동작, API 에러 등) | 해당 부분 수정 → 재테스트 |
| **FAIL** | 근본적 문제 (페이지 미로딩, 서버 에러 등) | 이전 단계부터 재검토 |

> **REWORK 연속 3회 시 FAIL로 에스컬레이션.**

**CONCERNS 판정 시 AskUserQuestion 호출**:
```
question: "경미한 UI 이슈가 발견되었습니다. 어떻게 진행할까요?"
header: "CONCERNS"
options:
  - label: "수용 — 진행 (Recommended)"
    description: "경미한 이슈를 인지하고 다음 단계로 진행합니다"
  - label: "수정 후 재테스트"
    description: "이슈를 수정한 뒤 test를 다시 실행합니다"
multiSelect: false
```

**REWORK 처리 흐름**:
1. 실패한 테스트 항목과 근거(스크린샷/로그)를 사용자에게 보고
2. 상태 파일의 `rework_count`를 +1 (`rework_count` ≥ 3이면 FAIL로 에스컬레이션)
3. phase를 `"implementing"`으로 되돌림
4. 수정 완료 후 `/forge-flow:verify` → `/forge-flow:test` 재실행

## 테스트 결과 기록

design 문서의 `## 검수 결과`, `## 검수 이력` 섹션에 기록:

```markdown
## 검수 결과
- verify: PASS (2026-03-17)
- test: PASS (2026-03-17)

## 검수 이력
### test
- #1 REWORK: 사용자 목록 페이지에서 페이지네이션 미동작
  → 수용: PageableResolver 파라미터 바인딩 수정
- #2 PASS
```

## 상태 파일 갱신 (완료 시)

PASS 시:
```json
{ "phase": "tested", "stop_count": 0, "rework_count": 0 }
```

REWORK 시:
```json
{ "phase": "implementing", "rework_count": +1 }
```

FAIL 시:
```json
{ "phase": "clarifying" }
```

## 완료 후 다음 단계

test PASS 후:
1. 작업 완료 보고
2. 커밋 안내 (사용자 판단)

커밋 완료 시 워크플로 파일을 정리합니다:

1. 상태 파일의 `design_file` 경로에서 design 파일 삭제
2. 상태 파일(`state-${CLAUDE_SESSION_ID}.json`) 삭제

```bash
# 커밋 완료 후 정리
rm -f "${DESIGN_FILE}"     # .forge-flow/design/{작업명}.md
rm -f "${STATE_FILE}"      # .forge-flow/state/state-${SESSION_ID}.json
```
