# forge-flow v3.1 개선 설계

> 상태: **구현 완료**
> 작성일: 2026-03-13
> 근거: namdomarket 프로젝트 설치 후 워크플로 검증에서 발견된 문제

---

## 발견된 문제 요약

namdomarket 프로젝트에 forge-flow v3.0.0 설치 후, 스킬 간 워크플로 체인을 검증한 결과
**상태 관리, 자동 진행, 품질 게이트 추적**에서 구현 누락이 확인됨.

---

## CRITICAL — 반드시 수정

### C1. rework_count 저장소 미정의

**현상**: review-req, review-plan, verify 모두 "REWORK 연속 3회 → FAIL 에스컬레이션" 규칙이 있지만, 카운터를 어디에 저장하는지 정의되어 있지 않음.

**해결**: 상태 파일에 `rework_count` 필드 추가. 각 검수 스킬 진입 시 0으로 초기화, REWORK 판정 시 +1, 다음 phase 전이 시 0 리셋.

```json
{
  "phase": "reviewing-req",
  "rework_count": 0
}
```

**영향 스킬**: review-req, review-plan, verify, clarify(초기화)

---

### C2. verify에서 선행 phase 미검증

**현상**: `/forge-flow:verify`를 직접 호출하면 clarify/plan 없이 실행됨. 상태 파일이 없거나 phase가 `implementing`이 아닌 경우 대응 없음.

**해결**: verify 실행 시 선행 조건 검사 추가.

```
1. 상태 파일 존재 확인 → 없으면: "워크플로가 시작되지 않았습니다. /forge-flow:clarify로 시작하세요."
2. phase == "implementing" 확인 → 아니면: "현재 {phase} 단계입니다. 구현 완료 후 verify를 실행하세요."
3. design_file 존재 확인 → 없으면: "설계 문서를 찾을 수 없습니다."
```

**영향 스킬**: verify

---

### C3. 자동 진행 메커니즘 미설명

**현상**: "자동으로 진행합니다"라고 적혀 있지만, 실제로 다음 스킬을 호출하는 구체적 방법이 없음. Claude는 SKILL.md의 지시에 따라 다음 스킬을 호출해야 하는데, 그 지시가 명확하지 않음.

**해결**: 각 스킬 완료 시 **명시적으로 다음 스킬을 호출하는 지시문** 추가.

```
## 완료 후 다음 단계
이 스킬의 모든 작업이 완료되면, 사용자의 추가 입력 없이 즉시 `/forge-flow:review-req`를 실행합니다.
```

이것은 Claude가 SKILL.md를 읽고 따르는 프롬프트 지시이므로, 자동 진행이 보장됨.

**영향 스킬**: clarify, review-req, plan, review-plan

---

## HIGH — 수정 권장

### H1. stop_count 리셋 시점 불일치

**현상**: clarify/review-req는 "완료 시" 리셋, plan/review-plan은 "시작 시" 리셋. 의미가 동일하지만 표현이 불일치.

**해결**: 모든 스킬에서 **"phase 전진 전이 시 0으로 리셋"**으로 통일. 구체적으로는 phase를 갱신하는 시점에 `stop_count: 0`도 함께 갱신.

**영향 스킬**: 전체

---

### H2. REWORK 재시도 주체 불명

**현상**: REWORK 판정 후 "수정 → 재검수"라고 하지만, 재검수를 자동으로 하는지, 사용자가 다시 호출하는지 불분명.

**해결**: REWORK 시 동작을 명확히 정의.

```
REWORK 판정 시:
1. 문제점을 사용자에게 보고
2. phase를 이전 단계로 되돌림 (예: reviewing-req → clarifying)
3. 사용자가 수정
4. workflow-state 훅이 현재 phase를 알려줌
5. 수정 완료 후 사용자가 다음 단계를 요청하면 해당 검수 스킬이 재실행됨
```

단, verify의 REWORK은 예외: phase를 `implementing`으로 되돌리고, 수정 후 사용자가 다시 `/forge-flow:verify` 호출.

**영향 스킬**: review-req, review-plan, verify

---

### H3. L 규모 verify 동작 미명시

**현상**: verify에서 S/M 검수 방식만 명시. L은 별도 설명 없음.

**해결**: L은 M과 동일한 검수 + 추가 조건 명시.

```
L 규모 (전체 검수):
- M의 모든 검수 항목 포함
- 추가: 아키텍처 영향 검토 (모듈 간 의존성 변경, API 계약 변경)
- 추가: 변경 전파 체인 검증 (CLAUDE.md의 전파 체인 테이블 기반)
```

에이전트팀 활성화 시에는 3중 검증(리뷰어 + 메인 + 서브에이전트).

**영향 스킬**: verify

---

### H4. review-plan 스킵 판정 로직 명확화

**현상**: M 규모에서 5개 조건 나열만 있고, 자동 판정인지 사용자에게 묻는지 불분명.

**해결**: plan이 5개 조건을 코드 분석 결과로 **자동 판정**하고, 결과를 사용자에게 보고.

```
[review-plan 실행 판정]
  ✅ 새 외부 의존성: spring-kafka 추가
  ❌ API 계약 변경: 없음
  ❌ DB 스키마 변경: 없음
  ✅ 3개 이상 모듈 영향: user, product, payment
  ❌ 프로젝트 새 패턴: 없음

  → 2개 조건 해당 → review-plan 실행합니다.
```

1개 이상 해당 시 review-plan 실행.

**영향 스킬**: plan

---

## MEDIUM — 개선 사항

### M1. 상태 파일 JSON 검증

각 스킬 시작 시 상태 파일 읽기 실패 시 에러 메시지 + 복구 안내.

```
상태 파일을 읽을 수 없습니다. /forge-flow:install --reset으로 초기화하세요.
```

### M2. 브랜치 생성 에러 핸들링

plan에서 브랜치 생성 시:
- 이미 존재하면 → 해당 브랜치로 checkout
- base 브랜치가 없으면 → 사용자에게 확인

### M3. FE 체크 트리거 조건 명확화

verify에서 FE 체크 실행 조건:
- CLAUDE.md에 `## FE 빌드 명령` 섹션이 존재하면 실행
- 없으면 스킵

### M4. 테스트 실행 통합

verify의 build-check에 테스트 명령도 포함:
- CLAUDE.md에 테스트 명령이 정의되어 있으면 빌드 후 테스트도 실행
- 정의 안 되어 있으면 스킵

---

## 구현 순서

```
Phase 1: CRITICAL (C1 → C2 → C3)
Phase 2: HIGH (H1 → H2 → H3 → H4)
Phase 3: MEDIUM (M1 → M2 → M3 → M4)
```

---

## 수정 대상 파일

| 파일 | 수정 항목 |
|------|----------|
| `skills/clarify/SKILL.md` | C1(rework_count 초기화), C3(다음 단계 지시), H1(stop_count 통일) |
| `skills/review-req/SKILL.md` | C1(rework_count 관리), C3(다음 단계 지시), H1, H2(REWORK 동작) |
| `skills/plan/SKILL.md` | C3(다음 단계 지시), H1, H4(판정 로직) |
| `skills/review-plan/SKILL.md` | C1(rework_count 관리), C3(다음 단계 지시), H1, H2 |
| `skills/verify/SKILL.md` | C1(rework_count 관리), C2(선행 검사), H1, H2, H3(L 규모) |
| `skills/build-check/SKILL.md` | M4(테스트 통합) |
| `skills/install/SKILL.md` | 버전 3.1.0 반영 |
| `.claude-plugin/plugin.json` | 버전 3.1.0 반영 |
