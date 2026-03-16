# forge-flow v2 — 워크플로 설계서

> 작성일: 2026-03-13
> 상태: 설계 검토 중

---

## 1. 플러그인 목적

forge-flow는 Claude Code 플러그인으로, 프로젝트에 **개발 워크플로를 설치**한다.

### 해결하려는 문제

| # | 문제 | 구체적 상황 |
|---|------|-----------|
| 1 | 요구사항 불명확 상태에서 작업 착수 | 프롬프트가 모호해도 Claude가 자의적으로 해석하고 진행 |
| 2 | 기존 코드 영향도 무시 | 이미 구축된 프로젝트에서 기존 패턴·로직 고려 없이 작업 |
| 3 | 검수 없이 완료 선언 | 요구사항 누락, 일부만 구현된 채 종료 |
| 4 | 단일 세션 검수 신뢰도 | 같은 세션이 자기 작업을 검수하면 편향 발생 |

### 대상 사용자

초급~특급 개발자 모두. 프로젝트 분석, 설계, 구현, 검수까지 범용적으로 사용 가능해야 함.

### 우선순위

**1순위: 작업 완성도** > 2순위: 작업 속도 > 3순위: 토큰 효율화

---

## 2. 워크플로 전체 흐름

```
(1) 프롬프트 입력
 │
 ▼
(2) 요구사항 명확화 ◄──┐      ← 예비 규모 판정
 │                     │ 불명확 시 재질문
 ▼                     │
(3) 요구사항 검수 ──────┘      ← 서브에이전트 교차검증 (S/M/L 모두 실행)
 │
 │  (2)↔(3) 합격할 때까지 반복
 │
 ▼
(4) 작업 계획 설계 ◄──┐        ← 확정 규모 판정 (S/M/L)
 │                     │ 설계 문제 시
 ▼                     │
(4-1) 설계 검수 ───────┘        ← M(조건부)/L만 실행, S는 스킵
 │
 │  (4)↔(4-1) 합격할 때까지 반복
 │
 ├── [병렬 가능 + 에이전트팀 활성화 시] 팀 구성 제안 → 사용자 승인
 │
 ▼
(5) 설계대로 구현
 │  단일 세션 구현 (기본)
 │  에이전트팀 병렬 구현 + 리뷰어 (병렬 가능 + 사용자 승인 시)
 │
 ▼
(6) 작업 내용 검수 ◄──┐        ← 가장 중요
 │                     │  S: 경량 (빌드 + AC)
 │  검수 실패 시 ──────┘  M/L: 표준 (메인 + 서브에이전트)
 │                        에이전트팀 사용 시: 3중 (리뷰어 + 메인 + 서브에이전트)
 │
 │  요구사항·설계 자체가 문제였으면
 │  → 사용자에게 재검토 요청 → (2)부터 재진행
 │
 ▼
(7) 작업 종료
```

---

## 3. 작업 규모 판정 — 2단계 체계

### 3.1 왜 2단계인가

| 시점 | 문제 |
|------|------|
| 요구사항에서만 판정 | 정보 부족으로 오판. "소셜 로그인 추가" → S로 보이지만 실제 L |
| 설계에서만 판정 | 이미 워크플로 방식이 결정된 후라 전환 비용 발생 |

### 3.2 예비 판정 (clarify 직후)

**목적**: 명백한 S와 명백한 L을 빠르게 걸러냄.

| 판정 | 근거 | 조치 |
|------|------|------|
| **명백한 L** | 사용자가 "대규모 리팩토링", "아키텍처 변경" 명시 / 영향 모듈 3개 이상 | 사용자에게 에이전트팀 즉시 제안 |
| **S/M/불확실** | 위 경우가 아닌 모든 것 | M으로 간주, plan 이후 확정 판정 |

### 3.3 확정 판정 (plan 직후)

**목적**: 변경 파일 목록이 구체화된 시점에서 **증거 기반 판정**.

| 규모 | 기준 | 근거 형식 (필수) |
|------|------|----------------|
| **S** | 변경 파일 1-2개, 기존 패턴 내 수정, 새 의존성 없음 | `영향 파일: src/config/app.yml (1개)` |
| **M** | 변경 파일 3-10개, 기존 로직 수정, 테스트 필요 | `영향 파일: src/auth/*.java (4개), test/auth/*.java (3개)` |
| **L** | 변경 파일 10+, 아키텍처 변경, 모듈 간 영향 | `영향 파일: 3개 모듈 15개 파일 (목록)` |

**규모 판정 시 반드시 구체적 파일 경로를 근거로 제시** (shinpr 패턴).

### 3.4 규모별 워크플로 분기

**clarify → review-req → plan 까지는 모든 규모에서 동일하게 실행.**
규모에 따라 달라지는 것은 plan 이후의 흐름.
> 예비 M → 확정 S가 되어도 review-req는 이미 실행됨. 완성도 우선 원칙에 따른 의도적 결정.

```
공통 (S/M/L 모두):
  clarify → review-req → plan (확정 규모 판정 + 병렬 가능성 판단)

S (단순) — plan 이후:
  → 구현 → verify(경량: 빌드 + AC 대조) → 완료

M/L (보통~대규모), 단일 세션 — plan 이후:
  → review-plan(조건부) → 구현 → verify(표준: 메인 + 서브에이전트) → 완료

M/L, 에이전트팀 (병렬 가능 + 활성화 + 사용자 승인) — plan 이후:
  → review-plan → 에이전트팀 구성 (사용자 승인)
  → 팀 병렬 구현 + 리뷰어 상시 리뷰
  → verify(3중: 리뷰어 + 메인 + 서브에이전트) → 완료
```

### 3.5 조건부 단계 실행

plan 이후 단계는 **확정 규모 기반으로 스킵/실행** 결정:

| 단계 | 실행 조건 | 스킵 조건 |
|------|----------|----------|
| review-req | **S/M/L 모두** | — (항상 실행) |
| review-plan | L 필수, M은 아래 조건 충족 시 | S |
| 에이전트팀 | 병렬 가능 + install에서 활성화 + 사용자 승인 (아래 참고) | 병렬 불가 or 비활성 or S |
| 서브에이전트 교차검증 (verify) | M, L | S |

**M 규모에서 review-plan 실행 조건** (하나라도 해당 시):
- 새 외부 의존성 도입
- API 계약 변경 (요청/응답 스키마)
- DB 스키마 변경
- 3개 이상 모듈에 영향
- 기존 프로젝트에 없던 패턴 도입

**에이전트팀 제안 조건** (모두 충족 시):
1. install에서 에이전트팀 활성화됨
2. 규모 S가 아님 (오버헤드 > 이득)
3. plan의 변경 파일 목록에서 **병렬 가능성**이 확인됨:

| 병렬 가능 | 병렬 불가 |
|----------|----------|
| 독립 모듈 간 변경 (의존성 없음) | A 완료 후 B 가능 (순차 의존) |
| FE + BE 동시 작업 | 단일 파일 체인 수정 |
| 서비스별 독립 변경 (MSA) | 공유 인터페이스 변경 후 구현체 수정 |

---

## 4. 스킬 구성

### 4.1 스킬 매핑

| 단계 | 스킬 | 역할 | 규모 |
|------|------|------|------|
| (2) | `/forge-flow:clarify` | 요구사항 명확화 + 예비 규모 판정 | S/M/L |
| (3) | `/forge-flow:review-req` | 요구사항 검수 (서브에이전트 교차검증) | S/M/L |
| (4) | `/forge-flow:plan` | 작업 계획 설계 + 확정 규모 판정 | S/M/L |
| (4-1) | `/forge-flow:review-plan` | 설계 검수 (요구사항 대조) | L, 조건부 M |
| (5) | (구현 — 스킬 아님) | 단일 세션 또는 에이전트팀 (병렬 가능 시) | S/M/L |
| (6) | `/forge-flow:verify` | 작업 내용 종합 검수 | S/M/L |
| — | `/forge-flow:build-check` | 빌드 검증 (verify 내부) | S/M/L |
| — | `/forge-flow:fe-check` | FE 전용 검증 (verify 내부) | 조건부 |
| 설치 | `/forge-flow:install` | 프로젝트 초기 세팅 | — |

### 4.2 현재 대비 변경점

| 현재 | 변경 | 이유 |
|------|------|------|
| `clarify`가 요구사항 + 검수 겸임 | `clarify`(명확화)와 `review-req`(검수) 분리 | 역할 분리, 교차검증 적용 |
| `pre-check`가 설계 + 리스크 겸임 | `plan`(설계)과 `review-plan`(검수) 분리 | 설계↔검수 반복 루프 지원 |
| `verify`가 같은 세션 2회 반복 | 규모별 검수 (S: 경량, M: 서브에이전트, L: 3중 검수) | 비용 대비 완성도 최적화 |
| 규모 분기 없음 | 2단계 규모 판정 + 조건부 단계 실행 | 단순 작업에 과도한 오버헤드 방지 |
| 에이전트팀 미활용 | 병렬 가능 시 에이전트팀 활용 (install에서 선택) | 병렬 구현 + 대화형 리뷰 |

---

## 5. 각 스킬 상세

### 5.1 clarify — 요구사항 명확화

**입력**: 사용자 프롬프트
**출력**: `design/{작업명}.md` + 예비 규모 판정

**동작**:
1. 프롬프트 분석 — 모호한 부분, 누락된 정보 식별
2. 프로젝트 컨텍스트 수집 — CLAUDE.md, 기존 코드 구조 파악
3. 영향 범위 사전 조사 — 관련 파일·모듈 개략 파악 (LSP 활용 가능 시)
4. 재질문 (필요 시) — 사용자에게 구체화 요청
5. 예비 규모 판정 — "명백한 L" 또는 "그 외(M 간주)". S 확정은 plan에서만
6. design 문서 작성:
   - 요구사항 정리
   - 인수 조건 (AC) — 검증 가능한 형태로 작성
   - 영향 받는 기존 코드/기능 목록 (개략)
   - 제약 조건
   - 예비 규모 판정 결과 + 근거

**명백한 L 판정 시**: 사용자에게 에이전트팀 구성 즉시 제안 가능.
**예비 판정과 무관하게** review-req는 항상 실행. 규모 분기는 plan 이후에만 적용.

### 5.2 review-req — 요구사항 검수

**실행 조건**: S/M/L 모두 (항상 실행)
**입력**: `design/{작업명}.md`
**출력**: PASS / CONCERNS / REWORK / FAIL + 피드백

**동작**:
1. **서브에이전트 생성** (worktree 격리)
2. 서브에이전트가 독립적으로 design 문서 검토:
   - AC가 검증 가능한가?
   - 모호하거나 모순되는 항목은 없는가?
   - 기존 코드와의 영향도가 충분히 파악되었는가?
   - 누락된 엣지케이스는 없는가?
3. 메인 세션이 서브에이전트 결과 종합
4. 결과 처리:
   - **PASS**: 다음 단계로 진행
   - **CONCERNS**: 경미한 이슈 알림, 사용자 판단으로 진행/수정
   - **REWORK**: 특정 항목 수정 후 재검수 (연속 3회 시 FAIL 에스컬레이션)
   - **FAIL**: 기존 design 파일을 유지한 채 clarify부터 재실행 (이전 피드백을 참고하여 개선)

### 5.3 plan — 작업 계획 설계

**입력**: 검수 완료된 `design/{작업명}.md`
**출력**: `design/{작업명}.md`에 구현 계획 섹션 추가 + **확정 규모 판정**

**동작**:
1. 기존 코드 분석 — LSP(참조 검색, 타입 확인) + 코드 탐색
   - LSP 없으면 grep + Glob으로 폴백
2. 변경 전파 체인 파악 — 이 변경이 어디까지 영향을 미치는가
3. **확정 규모 판정** — 변경 파일 목록 기반, 구체적 파일 경로를 근거로 제시
   - 확정 판정이 예비 판정과 다른 경우 사용자에게 알리고 워크플로 조정
4. 구현 계획 작성:
   - 변경 대상 파일 목록 (근거)
   - 변경 순서 (의존성 기반)
   - 리스크 항목
   - 테스트 계획
5. **병렬 가능성 판단** — 변경 파일 간 의존 관계 분석
   - 독립 모듈이 2개 이상이면 병렬 가능으로 판정
6. **기능 브랜치 분기** — CLAUDE.md의 브랜치 설정 참조:
   - 사용자가 특정 브랜치를 지정한 경우 → 해당 브랜치에서 작업
   - 지정 없으면 → 기준 브랜치에서 기능 브랜치 분기 (예: `feature/{작업명}`)
   - 브랜치 네이밍은 install에서 설정된 패턴 적용
7. 확정 규모 + 병렬 가능성에 따라 다음 단계 결정:
   - S → 구현으로 직행
   - M/L 단일 → review-plan (조건부) → 구현
   - M/L 병렬 가능 + 에이전트팀 활성 → review-plan → 에이전트팀 제안

### 5.4 review-plan — 설계 검수

**실행 조건**: L 필수. M은 섹션 3.5의 5가지 조건 중 하나라도 해당 시 실행.
**입력**: 구현 계획이 포함된 `design/{작업명}.md`
**출력**: PASS / CONCERNS / REWORK / FAIL + 피드백

**동작**:
1. 요구사항(AC)과 설계가 1:1 대응되는지 확인
2. 변경 전파 체인에 누락이 없는지 확인
3. 기존 코드 패턴과 설계가 일관되는지 확인
4. 결과 처리 (review-req과 동일한 4단계 품질 게이트)

### 5.5 verify — 작업 내용 검수

**입력**: 구현 완료된 코드 변경, `design/{작업명}.md`
**출력**: PASS / CONCERNS / REWORK / FAIL + 상세 리포트

**규모별 검수 방식**:

#### S 규모: 경량 검수
1. 빌드 검증 (build-check)
2. AC 대조 — design 문서의 AC 항목 체크
3. 교차검증 생략

#### M 규모: 표준 검수
1. **메인 세션 검수**:
   - 빌드 검증
   - 코드 리뷰 (diff 기반)
   - 패턴 일관성 (기존 코드와 비교)
   - AC 대조
2. **서브에이전트 교차검수** (worktree 격리):
   - design 문서 + diff만 전달 (메인 판단 결과 비공개)
   - 독립적으로 동일 검수 수행
3. **결과 종합**:
   - 양쪽 PASS → 작업 완료
   - 한쪽 불합격 → 불합격 항목 기반 수정 후 재검수
   - 요구사항·설계 자체가 문제 → 사용자에게 재검토 요청

#### 에이전트팀 사용 시: 3중 검수
1. **리뷰어 (에이전트팀)** — 구현 중 상시 리뷰 (정성적):
   - 구현자와 대화하며 방향 체크, 조기 문제 발견
   - "이 설계 의도가 맞나?" 질문 가능
   - 구현 완료 시 1차 리뷰 결과 제출
2. **verify 스킬 (메인/리더)** — 체크리스트 기반 기계적 검수 (정량적):
   - 빌드 검증
   - AC 항목 1:1 대조
   - 패턴 일관성
3. **서브에이전트 교차검수** (worktree 격리) — 독립 판단:
   - 리뷰어·메인 세션의 판단 결과 비공개
   - design 문서 + diff만으로 독립 검수

```
L 규모 검수에서 각 역할:

리뷰어 (에이전트팀)     verify (스킬)          서브에이전트
─────────────────    ──────────────       ──────────────
정성적 검수             정량적 검수            독립 검수
"왜 이렇게 했지?"        "AC 5개 중 5개?"       "내가 보기에는..."
구현 중 상시             구현 완료 후           구현 완료 후
대화형, 맥락 파악        체크리스트 기계적       diff + design만
설득당할 수 있음         기준 명확             편향 없음
```

**3중 검수 최종 판정**:
- 3개 모두 PASS → 작업 완료
- 일부 FAIL → 리더가 FAIL 항목을 정리하여 팀에 재배포
  - 리더가 에이전트팀을 재구성 (구현자에게 수정 지시)
  - 수정 완료 후 verify + 서브에이전트 교차검증 재실행
- 요구사항·설계 자체 문제 → 사용자에게 재검토 요청 → (2)부터 재진행
- 에이전트팀 세션이 이미 종료된 경우 → M 워크플로로 폴백 (단일 세션 수정 + 서브에이전트 재검수)

---

## 6. 에이전트팀 활용 (병렬 가능 시)

### 6.1 에이전트팀 제약과 대응

| 제약 | 대응 |
|------|------|
| 스킬에서 자동 생성 불가 | plan에서 병렬 가능 판정 시 사용자에게 제안, 승인 후 Claude가 자연어로 생성 |
| 사용자 승인 필요 | clarify/plan SKILL.md에 제안 문구 템플릿 포함 |
| 프로그래밍적 역할 지정 불가 | SKILL.md에 역할 템플릿 제공 → Claude가 자연어로 팀 구성 시 참조 |

### 6.2 팀 구성 제안 방식

plan에서 병렬 가능으로 판정되면 사용자에게 제안:

```
[규모: M, 병렬 가능]
변경 파일 7개, FE/BE 독립 작업이 가능합니다.
에이전트팀 구성을 권장합니다.

제안 구성:
- 구현자 A: module-auth 담당 (파일 6개)
- 구현자 B: module-api 담당 (파일 5개)
- 리뷰어: 교차 리뷰 + 통합 검수

팀을 구성할까요?
```

### 6.3 역할 템플릿

프로젝트 분석 결과에 따라 동적으로 구성:

| 프로젝트 유형 | 구현자 구성 | 리뷰어 |
|-------------|-----------|--------|
| BE 모노레포 | 모듈별 분담 | 통합 리뷰 + 인터페이스 정합성 |
| 풀스택 | BE 담당 + FE 담당 | API 계약 리뷰 + 통합 검수 |
| FE 단독 | 컴포넌트 담당 + 상태관리 담당 | UX 일관성 리뷰 |
| 마이크로서비스 | 서비스별 분담 | 서비스 간 통신 리뷰 |

### 6.4 리뷰어의 역할 (에이전트팀 내)

리뷰어는 verify 스킬을 **대체하지 않고 보완**한다.

**구현 중 (상시)**:
- 구현자의 작업 방향이 design 문서와 일치하는지 체크
- 기존 프로젝트 패턴과 벗어나는 구현 조기 발견
- 구현자에게 직접 질문 가능 ("이 부분 의도가 뭐야?")

**구현 완료 후**:
- 1차 정성적 리뷰 결과 제출
- verify 스킬의 기계적 검수 + 서브에이전트 독립 검수와 합산하여 최종 판정

**리뷰어 지침 (팀 생성 시 전달)**:
```
1. design/{작업명}.md의 AC 항목을 기준으로 리뷰
2. 기존 코드 패턴과의 일관성 확인 (네이밍, 에러 처리, 구조)
3. 구현자의 설명에 납득되더라도, 객관적 기준(AC, 패턴)과 불일치하면 FAIL
4. 리뷰 결과를 design 문서의 검수 이력에 기록
```

### 6.5 에이전트팀 미사용 시 (거부 / 비활성 / 병렬 불가)

에이전트팀을 사용하지 않는 경우 **단일 세션 워크플로**:
- 단일 세션 구현
- verify에서 서브에이전트 교차검증 (M/L)
- 리뷰어 상시 리뷰 없음 (대신 서브에이전트가 보완)

### 6.6 install에서 에이전트팀 환경 준비

install 시 사용자가 에이전트팀 활성화를 **선택**:

- **활성화 시**: settings.local.json에 환경변수 주입, 병렬 가능 시 에이전트팀 제안
- **비활성화 시 (기본값)**: 환경변수 미주입, 단일 세션 워크플로로 폴백

> 에이전트팀은 선택 기능. 비활성이어도 워크플로는 정상 동작.

---

## 7. 프로젝트 특화 설정 — 동적 구성 전략

### 7.1 설계 원칙

install 시 수집하는 프로젝트 정보는 **워크플로 단계에서 실제로 필요한 것만** 수집한다.

```
프로젝트 상태 판별:
  ┌─ 기존 프로젝트 (소스/빌드 파일 존재) → 자동 감지 우선, 감지 불가 시 질문
  └─ 신규 프로젝트 (빈 디렉토리/README만) → Q&A 기반 수집

수집 항목 분류:
  ┌─ 워크플로가 이것 없이 동작 불가? ──→ 필수 수집 (자동 감지 or Q&A)
  ├─ 자동 감지 가능? ──→ 감지 + 확인
  ├─ 자동 감지 불가? ──→ 질문으로 수집
  ├─ 사용자 취향? ──→ 선택 옵션
  └─ 런타임에 Claude가 판단 가능? ──→ 수집하지 않음
```

### 7.2 수집 항목

| 항목 | 필요한 단계 | 기존 프로젝트 | 신규 프로젝트 |
|------|-----------|:----------:|:----------:|
| **빌드 명령** | verify, build-check | 자동 감지 + 확인 | Q&A (미정이면 스킵, 이후 재설정) |
| **테스트 명령** | verify | 자동 감지 + 확인 | Q&A (미정이면 스킵) |
| **프로젝트 구조** (모노레포/단일) | plan, verify | 자동 감지 | Q&A |
| **FE/BE 구분** | fe-check 활성화 | 자동 감지 | Q&A (계획 중인 스택) |
| **기준 브랜치** | plan (브랜치 분기 기준) | 자동 감지 (default branch) + 확인 | Q&A |
| **브랜치 네이밍 패턴** | plan (기능 브랜치 생성) | 기존 브랜치 패턴 분석 (feature/*, feat/*), 불명확 시 Q&A | Q&A |
| **프로젝트 루트 경로** | 전체 | 빌드 파일 위치 추정, 불명확 시 Q&A (7.6 참고) | Q&A |
| **에이전트팀 활성화** | 병렬 가능 시 구현 | 사용자 선택 (기본: OFF) | 사용자 선택 (기본: OFF) |

**수집 불필요 (제거)**:

| 항목 | 제거 이유 |
|------|----------|
| 프로젝트 설명 | clarify가 매 작업마다 코드를 읽어 판단 |
| 역할 목록 | 에이전트팀 구성 시 동적 결정 |
| MCP 목록 | Claude가 자동 인식. 워크플로가 특정 MCP에 의존하면 안 됨 |

> **신규 프로젝트에서 "미정" 항목**: 빌드/테스트 명령이 아직 결정 안 된 경우 스킵 가능. 이후 프로젝트 세팅이 갖춰지면 `/forge-flow:install`을 재실행하여 업데이트.

### 7.3 install 흐름

```
v2 install:
1. 프로젝트 상태 판별
   ├─ 기존: 자동 감지 실행 (analyze-project.py)
   │   → 빌드/테스트 명령, 프로젝트 구조, FE 여부, git 브랜치 패턴
   └─ 신규: 자동 감지 스킵 → 2단계로 직행

2. 수집 (감지 결과 확인 + 미감지 항목 질문)
   기존 프로젝트:
     → 감지 성공: "감지된 빌드 명령: ./gradlew build. 맞나요?"
     → 감지 실패: "git 브랜치 전략이 감지되지 않았습니다. (예: git-flow, trunk-based, 없음)"
   신규 프로젝트:
     → "사용할 기술 스택은? (예: Spring Boot + React, Next.js, Python FastAPI)"
     → "빌드 명령은? (아직 미정이면 Enter로 스킵)"
     → "기준 브랜치는? (예: main, develop)"
     → "기능 브랜치 패턴은? (예: feature/*, feat/*, 없음)"

3. 사용자 선택 (옵션)
   → "에이전트팀 기능을 활성화할까요? (L 규모 작업에서 병렬 구현 + 리뷰어) [Y/n]"

4. 설치 실행
   → CLAUDE.md 패치 (워크플로 규칙 + 수집된 프로젝트 설정)
   → hooks 설정 (UserPromptSubmit, Stop, PreToolUse)
   → .forge-flow/ 디렉토리 생성
   → 조건부: fe-check (FE만), 에이전트팀 환경변수 (선택 시만)
```

**설계 원칙**: 플러그인 = 범용, install = 프로젝트 특화.

```
플러그인 (전역, 범용)          install (프로젝트별, 특화)
──────────────────          ────────────────────────
스킬 정의 (SKILL.md)         → CLAUDE.md에 프로젝트 설정 패치
워크플로 흐름 규칙            → hooks에 프로젝트 경로 반영
품질 게이트 기준              → fe-check 활성/비활성
에이전트팀 역할 템플릿         → 에이전트팀 활성/비활성 (사용자 선택)
```

### 7.4 조건부 스킬 설치

| 스킬 | 설치 조건 | 감지 방법 |
|------|----------|----------|
| `build-check` | 항상 | — |
| `fe-check` | FE 프로젝트 감지 시 | package.json + 프레임워크 의존성 |

### 7.5 Graceful Degradation

모든 도구 의존은 **폴백 경로**를 가져야 함:

| 도구 | 없을 때 폴백 |
|------|-------------|
| LSP | grep + Glob 기반 참조 검색 |
| 브라우저 MCP | UI 테스트 스킵, 사용자 수동 테스트 |
| 에이전트팀 | 단일 세션 워크플로로 폴백 (서브에이전트 교차검증) |

### 7.6 작업 디렉토리와 프로젝트 루트

사용자가 프로젝트 상위 디렉토리에서 Claude Code를 실행하는 경우가 있음.

```
~/projects/                ← Claude Code 실행 위치 (cwd)
├── frontend/              ← 실제 프로젝트 A
│   └── package.json
└── backend/               ← 실제 프로젝트 B
    └── build.gradle
```

**install 시 처리**:
- 자동 감지: cwd에 빌드 파일(package.json, gradlew 등)이 없으면 하위 디렉토리 스캔
- 프로젝트 루트 후보가 여러 개면 사용자에게 확인: "프로젝트 루트가 어디인가요? (1) frontend/ (2) backend/ (3) 현재 디렉토리"
- 선택 결과를 CLAUDE.md에 기록 → 이후 스킬들이 참조

**design/, .forge-flow/ 위치**: 항상 install 시 확인된 프로젝트 루트 기준.

---

## 8. 기술 구현 방안

### 8.1 사용 기술과 역할

| 기술 | 용도 | 비고 |
|------|------|------|
| **Skills 2.0** | 각 단계별 프롬프트 정의 + 자동 트리거 | description 기반 자동 감지 |
| **Hook (UserPromptSubmit)** | 워크플로 상태 감지 + 컨텍스트 주입 | 상태 파일 읽어 동적 주입 |
| **Hook (Stop, command 타입)** | 검수 완료 전 종료 차단 | decision: block 시 Claude 계속 작업 |
| **Hook (PreToolUse)** | 위험 작업 차단 | DB 변경, force push 등 |
| **서브에이전트 (Agent tool)** | 교차검증 수행 | worktree 격리로 독립 판단 |
| **에이전트팀** | 병렬 가능 시 구현 + 대화형 리뷰 | install에서 활성화 선택, 자연어로 생성, 사용자 승인 |
| **LSP** | 코드 영향도 분석 | 참조 검색, 타입 체크 (폴백: grep) |
| **design/ 파일** | 단계 간 상태 전달 | 요구사항 → 설계 → 검수 기준 |
| **세션 스코프 상태** | 멀티 터미널 독립 동작 | `${CLAUDE_SESSION_ID}` 기반 |

### 8.2 Skills 2.0 자동 트리거 활용

description 필드로 Claude가 프롬프트 분석 후 자동 로드.

| 스킬 | 트리거 조건 | 제어 |
|------|-----------|------|
| `clarify` | 구현 요청 감지 (기능 추가, 버그 수정 등) | 자동 + 수동 |
| `review-req` | clarify 완료 후 design 문서 존재 시 | 자동 + 수동 (재실행 가능) |
| `plan` | review-req PASS 후 | 자동 + 수동 (재실행 가능) |
| `review-plan` | plan 완료 후, M(조건부)/L 규모 시 | 자동 + 수동 (재실행 가능) |
| `verify` | 구현 완료 시 | 자동 + 수동 |
| `build-check` | verify 내부에서 호출 | `user-invocable: false` |
| `fe-check` | verify 내부에서 호출 (FE 프로젝트) | `user-invocable: false` |

### 8.3 워크플로 강제 — 4중 방어

#### Layer 1: Skills 2.0 description 자동 트리거

구현 요청 키워드를 description에 포함시켜 새 작업 시 clarify 자동 감지.

#### Layer 2: UserPromptSubmit 훅 — 상태 기반 동적 컨텍스트

```bash
#!/bin/bash
# .claude/hooks/workflow-state.sh
INPUT=$(cat)
SESSION_ID="${CLAUDE_SESSION_ID}"
STATE_FILE=".forge-flow/state-${SESSION_ID}.json"

if [ -f "$STATE_FILE" ]; then
  # 기존 세션 — 상태 파일 기반 컨텍스트 주입
  PHASE=$(jq -r '.phase' "$STATE_FILE")
  DESIGN_FILE=$(jq -r '.design_file' "$STATE_FILE")
  case "$PHASE" in
    implementing)
      echo "{\"additionalContext\": \"[WORKFLOW] 구현 중. 완료 시 /forge-flow:verify 필수. design: $DESIGN_FILE\"}" ;;
    verified)
      echo "{\"additionalContext\": \"[WORKFLOW] 검수 완료. 커밋 가능.\"}" ;;
    *)
      echo "{\"additionalContext\": \"[WORKFLOW] 현재 단계: $PHASE. design: $DESIGN_FILE\"}" ;;
  esac
elif ls design/*.md 1>/dev/null 2>&1; then
  # 새 세션이지만 design/ 파일 존재 — orphan 감지
  # 주의: clarify가 design 파일 생성 직후 state 파일 생성 전이면 오탐 가능 (허용 가능한 수준)
  ORPHANS=""
  for f in design/*.md; do
    REFERENCED=$(grep -rl "$(basename "$f")" .forge-flow/state-*.json 2>/dev/null)
    if [ -z "$REFERENCED" ]; then
      ORPHANS="$ORPHANS $f"
    fi
  done
  if [ -n "$ORPHANS" ]; then
    echo "{\"additionalContext\": \"[WORKFLOW] 이전 작업 감지:$ORPHANS. 이어서 진행하려면 알려주세요.\"}"
  else
    echo "{\"additionalContext\": \"[WORKFLOW] 새 작업 감지. /forge-flow:clarify로 요구사항을 먼저 명확히 하세요.\"}"
  fi
else
  echo "{\"additionalContext\": \"[WORKFLOW] 새 작업 감지. /forge-flow:clarify로 요구사항을 먼저 명확히 하세요.\"}"
fi
exit 0
```

#### Layer 3: CLAUDE.md 워크플로 규칙

```markdown
## 작업 원칙
- 새 작업 시작 시 반드시 /forge-flow:clarify 먼저 실행
- clarify 없이 구현 착수 금지
- verify 합격 없이 작업 완료 선언 금지
- design/ 문서의 AC 항목을 모두 충족해야 작업 완료
```

#### Layer 4: Stop 훅 — 검수 완료 전 종료 차단

**2단 구조**: command 타입(빠른 판정 + circuit breaker) → agent 타입(상세 확인)

```json
{
  "hooks": {
    "Stop": [
      {
        "type": "command",
        "command": ".claude/hooks/stop-guard.sh"
      }
    ]
  }
}
```

**stop-guard.sh 동작**:
```bash
#!/bin/bash
SESSION_ID="${CLAUDE_SESSION_ID}"
STATE_FILE=".forge-flow/state-${SESSION_ID}.json"

# 1. 상태 파일 없으면 → 워크플로 밖, 통과
if [ ! -f "$STATE_FILE" ]; then
  echo '{"decision": "allow"}'
  exit 0
fi

PHASE=$(jq -r '.phase' "$STATE_FILE")

# 2. 이미 검수 완료면 → 즉시 통과
if [ "$PHASE" = "verified" ] || [ "$PHASE" = "completed" ]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# 3. Circuit breaker — 연속 stop 횟수 확인
STOP_COUNT=$(jq -r '.stop_count // 0' "$STATE_FILE")
STOP_COUNT=$((STOP_COUNT + 1))
jq --argjson c "$STOP_COUNT" '.stop_count = $c' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"

if [ "$STOP_COUNT" -ge 3 ]; then
  # 3회 연속 → 강제 통과 + 카운터 리셋
  jq '.stop_count = 0' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
  echo '{"decision": "allow"}'
  exit 0
fi

# 4. 미완료 → 차단
echo '{"decision": "block", "reason": "워크플로 미완료 (phase: '"$PHASE"'). verify 합격 후 종료하세요."}'
exit 0
```

**핵심 설계**:
- `stop_count`는 command 훅(bash)이 관리 — agent가 파일 쓰기할 필요 없음
- 각 스킬이 phase 전이 시 `stop_count`를 0으로 리셋 (정상 진행 중이면 카운터 쌓이지 않음)
- 연속 3회 차단 시 강제 통과 (circuit breaker) — 무한 루프 방지

### 8.4 자동 실행 흐름 — 요구사항 확정 후 자율 수행

사용자가 요구사항을 확인하면 **plan → implement → verify까지 자동 진행**.

```
사용자: "로그인 페이지에 소셜 로그인 추가해줘"
  │
  ▼ [Skills 2.0 → clarify 자동 로드]
clarify: 요구사항 명확화, 재질문, 예비 규모 판정 (M 추정)
  │
  ▼ [사용자 확인: "네, 맞습니다"]
  │  ← 이후 사용자 입력 없이 자동 진행 (위험 작업 제외)
  │
review-req: 서브에이전트 교차검증 → PASS
  │
plan: 구현 계획 설계, 확정 규모 M (파일 7개)
  │
review-plan: 설계 검수 → PASS
  │
구현: Claude가 설계대로 코드 작성
  │
verify: 메인 검수 + 서브에이전트 교차검증
  │  └─ 실패 시 자동 수정 → 재검수
  │
  ▼ [PASS]
작업 완료 보고
```

**사용자 개입이 필요한 지점** (PreToolUse 훅):
- DB 스키마 변경 (DROP, ALTER, DELETE)
- `git push --force`, `git reset --hard`
- 설정 파일 변경 (.env, credentials)
- 외부 API 호출 (결제, 메일 발송 등)

### 8.5 세션 독립 루프 시스템

#### 문제: ralph-loop의 세션 간섭

`.claude/ralph-loop.local.md`를 전 세션이 공유하여 멀티 터미널에서 간섭 발생.

#### 해결: 세션 스코프 상태 관리

```
.forge-flow/
├── state-{SESSION_ID_A}.json    ← 터미널 A 전용 (세션 스코프)
└── state-{SESSION_ID_B}.json    ← 터미널 B 전용 (세션 스코프)

design/                           ← 프로젝트 루트에 위치 (공유, 작업 단위)
└── social-login.md               ← 각 상태 파일이 design_file로 자기 파일을 참조

> **동시 세션 충돌 방지**: clarify가 design 파일 생성 시, 동일 파일명이 이미 존재하고 다른 세션이 참조 중이면 `{작업명}-2.md` 등으로 자동 넘버링.
```

**상태 파일 구조**:
```json
{
  "session_id": "abc123",
  "phase": "implementing",
  "scale": "M",
  "design_file": "design/social-login.md",
  "stop_count": 0,
  "started_at": "2026-03-13T10:00:00Z"
}
```

**phase 값 정의**:

| phase | 설정 주체 | 의미 |
|-------|----------|------|
| `clarifying` | clarify 시작 시 | 요구사항 명확화 중 |
| `reviewing-req` | review-req 시작 시 | 요구사항 검수 중 |
| `planning` | plan 시작 시 | 설계 중 |
| `reviewing-plan` | review-plan 시작 시 | 설계 검수 중 |
| `implementing` | plan/review-plan PASS 후 | 구현 중 |
| `verifying` | verify 시작 시 | 검수 중 |
| `verified` | verify PASS 시 | 검수 완료, 커밋 가능 |
| `completed` | Claude가 커밋 완료 후 | 작업 종료 |

**상태 파일 생명주기**:
- **생성**: clarify 시작 시 (`phase: "clarifying"`)
- **갱신**: 각 단계 전이 시
- **삭제**: verify PASS 후 커밋 완료 시 / 사용자가 수동 정리 시
- **정리**: install에 cleanup 스크립트 포함 — 24시간 이상 된 상태 파일 목록을 표시하고 사용자 확인 후 삭제

**루프 구현**: Stop 훅(command 타입) + 상태 파일로 세션 독립 루프.
- `phase`가 `verified`/`completed`가 아니면 차단 → Claude 계속 작업
- `phase`가 `verified`/`completed`이면 통과 → 루프 종료
- `stop_count >= 3` 시 강제 통과 (circuit breaker) — 사용자에게 현재 상태 보고

**필드 관리 주체**:
| 필드 | 갱신 주체 | 시점 |
|------|----------|------|
| `phase` | 각 스킬 (clarify, plan, verify 등) | 스킬 시작/완료 시 |
| `stop_count` | stop-guard.sh (Stop 훅) | Stop 이벤트 발생 시 +1, 스킬이 **전진 방향** phase 전이 시 0으로 리셋 (FAIL로 인한 후퇴 시 리셋하지 않음) |
| `scale` | plan 스킬 | 확정 규모 판정 시 |
| `design_file` | clarify 스킬 | design 문서 생성 시 |

### 8.6 품질 게이트 — 4단계 체계

모든 검수 스킬(review-req, review-plan, verify)에 공통 적용 (levnikolaevich 패턴):

| 등급 | 의미 | 조치 |
|------|------|------|
| **PASS** | 문제 없음 | 다음 단계로 진행 |
| **CONCERNS** | 경미한 이슈, 진행 가능 | 사용자에게 알리고 판단 위임 |
| **REWORK** | 특정 부분 수정 필요 | 해당 부분만 재작업 → 재검수 (연속 3회 REWORK 시 FAIL로 에스컬레이션) |
| **FAIL** | 근본적 문제 | 이전 단계부터 재검토 |

### 8.7 design/ 파일 구조

```markdown
# {작업명}

## 요구사항
- ...

## 인수 조건 (AC)
- [ ] AC-1: 구체적이고 검증 가능한 조건
- [ ] AC-2: ...

## 영향 범위
- 변경 대상: src/auth/LoginService.java, src/auth/SocialAuthProvider.java (2개)
- 영향 받는 기존 기능: 기존 로그인 플로우, 세션 관리

## 규모 판정
- 예비 (clarify): M — 인증 모듈 내 변경, 외부 OAuth 연동
- 확정 (plan): M — 변경 파일 7개 (src/auth/ 4개, test/auth/ 3개)

## 구현 계획
- 변경 파일 목록 (경로)
- 변경 순서
- 리스크 항목

## 검수 결과
- review-req: PASS (2026-03-13)
- review-plan: PASS (2026-03-13)
- verify: PASS (2026-03-13)

## 검수 이력
### review-req
- #1 CONCERNS: AC-3 "응답시간 500ms 이내" → 측정 기준 모호
  → 수용: "p95 기준 500ms"로 구체화

### verify
- #1 REWORK: 기존 ErrorHandler 패턴과 불일치
  → 수용: try-catch → ErrorHandler.wrap() 패턴으로 변경
- #2 PASS
```

### 8.8 서브에이전트 프롬프트 원칙

교차검증용 서브에이전트(review-req, verify)에 전달하는 프롬프트의 핵심 원칙:

1. **메인 세션 판단 결과 비공개** — 서브에이전트에게 메인의 검수 결과를 전달하지 않음 (독립 판단 보장)
2. **구조화 응답 강제** — 체크리스트 형태로 각 항목에 PASS/FAIL + 근거를 반환하도록 지시
3. **최소 입력** — design 문서 + diff(또는 변경 대상 파일)만 전달. 대화 이력, 구현 의도 등 제외
4. **반대 관점 검토 지시** — "누락, 모순, 엣지케이스를 찾는 것이 목표"임을 명시

구체적 프롬프트 템플릿은 각 SKILL.md에서 정의.

### 8.9 세션 복구 메커니즘

컨텍스트 윈도우 초과, 세션 중단 시 워크플로 상태 복구 (deep-plan 패턴):

**복구 우선순위**: design/ 파일 > 상태 파일 (design이 진실의 원천)

1. **같은 세션에서 복구** (컨텍스트 압축 후):
   - 상태 파일 `state-{SESSION_ID}.json`이 존재 → 현재 phase부터 이어서 진행
   - design 문서의 검수 결과/이력 섹션이 복구 맥락 제공

2. **새 세션에서 복구** (세션 종료 후 재시작):
   - 새 SESSION_ID 발급됨 → 기존 상태 파일과 불일치
   - **design/ 파일 기반 복구**: UserPromptSubmit 훅이 design/ 디렉토리를 스캔
     - design 문서 존재 + 검수 결과 없음 → `review-req`부터 재개
     - 구현 계획 있음 + verify 기록 없음 → `implementing`부터 재개 (git diff로 변경 유무 확인)
     - verify FAIL 이력 있음 → 수정 후 `verify` 재실행
   - 새 상태 파일 생성 시 scale은 design 문서의 "규모 판정" 섹션에서 복원

3. **복구 불가 시**: 사용자에게 "이전 작업 design/{작업명}.md를 발견했습니다. 이어서 진행할까요?" 확인

---

## 9. 실현 가능성 분석

### 구현 가능 (검증됨)

| 항목 | 근거 |
|------|------|
| Skills 2.0 description 기반 자동 트리거 | 공식 지원, description 매칭으로 자동 로드 |
| UserPromptSubmit 훅으로 상태 기반 동적 주입 | additionalContext로 파일 읽어 주입 가능 |
| Stop 훅 (command 타입)으로 검수 강제 | decision: block 시 Claude 계속 작업 (공식 지원) |
| PreToolUse 훅으로 위험 작업 차단 | permissionDecision: deny/ask (공식 지원) |
| 서브에이전트 worktree 격리 교차검증 | Agent tool `isolation: "worktree"` 공식 지원 |
| 에이전트팀 병렬 구현 | 공식 지원, 자연어로 생성, install에서 사용자 선택 |
| 세션 스코프 상태 관리 | `${CLAUDE_SESSION_ID}` 환경변수 공식 지원 |
| 빌드 명령 자동 감지 | 파일 기반 감지, analyze-project.py (v1 `skills/install/scripts/`에 구현됨) |
| 4단계 품질 게이트 | 스킬 내 판정 로직으로 구현 |

### 구현 가능하나 제약 있음

| 항목 | 제약 | 대응 |
|------|------|------|
| 스킬 자동 트리거 정확도 | description 매칭은 확률적 | 4중 방어로 보완 |
| 스킬 간 자동 체이닝 | 프로그래밍적 호출 불가 | 3중 보완: (1) SKILL.md 마지막에 "완료 후 다음 스킬 실행" 지시 포함, (2) description 매칭, (3) UserPromptSubmit 훅이 "다음은 X 단계" 컨텍스트 주입 |
| 에이전트팀 자동 생성 | 스킬에서 직접 생성 불가 | 사용자에게 제안 → 승인 후 Claude가 자연어로 생성 |
| 교차검증 편향 | 동일 모델 편향 가능 | "반대 관점 검토" 지시 + 구조화 체크리스트 + 3중 검수 |
| Stop 훅 무한 루프 | 계속 차단 반환 가능 | command 훅에서 stop_count 관리 + 3회 연속 시 강제 통과 (circuit breaker) |

### 구현 불가능 (설계에서 제외)

| 항목 | 이유 | 대안 |
|------|------|------|
| 독립 세션 간 교차검증 | 세션 간 통신 없음 | 서브에이전트(worktree 격리)로 대체 |
| 스킬에서 에이전트팀 자동 생성 | 사용자 승인 필수 | 제안 → 승인 → 생성 흐름 |
| 훅 간 순차 실행 | 같은 이벤트 훅은 병렬 | 단일 스크립트 내 순차 처리 |

---

## 10. 현재 플러그인 대비 변경 요약

| 구분 | 현재 (v1) | v2 |
|------|----------|-----|
| 스킬 수 | 6개 (clarify, pre-check, verify, build-check, fe-check, install) | 8개 (review-req, plan, review-plan 추가 / pre-check → plan+review-plan으로 분리) |
| 스킬 트리거 | 수동 호출 + 훅 힌트 | Skills 2.0 description 자동 트리거 |
| 규모 판정 | 없음 | 2단계 판정 (예비 + 확정), 분기는 plan 이후만 |
| review-req | 규모에 따라 스킵 | S/M/L 모두 항상 실행 (규모 전환 리스크 제거) |
| 교차검증 | 같은 세션 2회 반복 | 규모별: S 경량, M 서브에이전트, L 3중 검수 |
| 에이전트팀 | 미활용 | 병렬 가능 시 구현 + 리뷰어 (규모 무관, install에서 활성화 선택) |
| 품질 게이트 | PASS/FAIL 2단계 | PASS/CONCERNS/REWORK/FAIL 4단계 |
| 워크플로 강제 | UserPromptSubmit 훅만 | 4중 방어 (Skills + 훅 + CLAUDE.md + Stop) |
| 자동 실행 | 없음 (매 단계 수동) | 요구사항 확정 후 자율 수행 |
| 위험 작업 보호 | 없음 | PreToolUse 훅으로 차단 |
| 루프 시스템 | 외부 스크립트 (ralph 방식) | Stop 훅 기반 세션 독립 루프 |
| 멀티 세션 | 세션 간 간섭 | `${CLAUDE_SESSION_ID}` 기반 완전 독립 |
| 상태 관리 | 암묵적 | design/(프로젝트 루트) + .forge-flow/state(세션 스코프) + 복구 |
| 상태 생명주기 | 없음 | 생성→갱신→삭제 정의, phase 열거형, 정리 스크립트 |
| install | 7개 Q&A | 기존: 자동 감지 + 확인, 신규: Q&A 기반 수집. 재실행으로 업데이트 가능 |
| memory 관리 | `.agent/workspace/memory/` | 제거 — design/ 검수 이력이 작업 단위 기록 담당. 외부 MCP 비종속 |
| Graceful degradation | 없음 | 모든 도구 의존에 폴백 경로 |

---

## 11. 구현 순서 (안)

1. **Phase 1**: 핵심 스킬 재설계
   - clarify (예비 규모 판정 포함), plan (확정 규모 판정 포함) SKILL.md 작성
   - review-req, review-plan, verify SKILL.md 작성 (4단계 품질 게이트)
   - design/ 파일 구조 확정 (규모 판정, 검수 이력 포함)
   - Skills 2.0 description 최적화

2. **Phase 2**: 상태 관리 + 훅 시스템
   - `.forge-flow/state-{SESSION_ID}.json` 상태 파일 스키마 확정 + 생명주기 구현
   - Stop 훅 (command 타입) 구현 — stop-guard.sh + circuit breaker
   - UserPromptSubmit 훅 — 상태 파일 기반 동적 컨텍스트 주입 + orphan 감지
   - PreToolUse 훅 — 위험 작업 차단
   - CLAUDE.md 템플릿 업데이트

3. **Phase 3**: 교차검증 + 에이전트팀
   - verify에 규모별 검수 로직 (S: 경량, M/L: 서브에이전트, 에이전트팀 시: 3중 검수)
   - review-req에 서브에이전트 요구사항 검수
   - 에이전트팀 역할 템플릿 + 제안 로직

4. **Phase 4**: 세션 복구 + 안정화
   - 세션 복구 메커니즘 (design 기반 phase 추론)
   - 멀티 세션 동시 작업 안정화 (design 파일 충돌 방지)

5. **Phase 5**: install 간소화
   - analyze-project.py 강화
   - Q&A 제거 → 자동 감지 + 확인
   - 에이전트팀 환경변수 주입
   - 레거시 제거 (v1 `.agent/workspace/` → v2 `design/` + `.forge-flow/` 마이그레이션 포함)

6. **Phase 6**: 테스트
   - 단일 세션: S/M/L 각 규모별 전체 워크플로
   - 멀티 터미널: 세션 독립성
   - 에이전트팀: L 규모 팀 구성 + 3중 검수
   - 실 프로젝트 적용 (BE, FE, 풀스택 각 1개 이상)

---

## 12. 참고 레퍼런스

상세 내용: `docs/workflow-references.md`

| 프로젝트 | 적용한 패턴 |
|----------|-----------|
| Superpowers (obra) | spec-first, 점진적 설계 승인 |
| Deep Trilogy (piercelamb) | 결정 근거 기록, 세션 복구 |
| shinpr/claude-code-workflows | 증거 기반 규모 판정, AC 추적 |
| levnikolaevich/claude-code-skills | 4단계 품질 게이트 |
| Ralph-Loop | 세션 격리 교훈, circuit breaker |
| catlog22/Claude-Code-Workflow | 조건부 단계 실행, 규모별 분기 |
