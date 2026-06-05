# forge-flow 오케스트레이션 재설계 (v5.1 제안)

> **목표**: 분석·구현 단계의 멀티에이전트 오케스트레이션을 재정비한다.
> 핵심 질문은 "직렬을 병렬로 바꾸자"가 **아니다** — forge-flow는 이미 병렬화돼 있다.
> 진짜 질문은 **(1) 어떤 메커니즘으로(Agent팀 vs Workflow도구) (2) 무엇을 근거로 분해할지(휴리스틱 vs 결정론적 게이트)** 이다.

---

## 0. 전제 정정 — 현행 상태 (v5.0.0 실측)

초기 분석에서 "분석·구현은 메인스레드 단독"이라 기술했으나 **이는 틀렸다**. `Workflow(` 호출만 grep해 과일반화한 결과였다. 전체 SKILL.md 정독 결과 현행은 다음과 같다.

| 단계 | 현행 오케스트레이션 | 병렬화 여부 | 스케일 게이트 |
|------|--------------------|------------|--------------|
| clarify | **Explore Agent팀** (TeamCreate+Agent) — 정보수집 | ✅ 이미 병렬 | 예비 M/L |
| review-req | **Workflow 도구** — 관점 fan-out + 적대적 확정 | ✅ | 항상 |
| plan | **Explore Agent팀** — 코드분석 + impl팀 구성설계 | ✅ 이미 병렬 | 확정 S/M/L (파일 수) |
| review-plan | **Workflow 도구** — judge panel | ✅ | L필수/M조건/S스킵 |
| implement | **메인 단독(S) 또는 impl Agent팀(M/L)** | ✅ 이미 스케일별 분기 | (plan서 확정) |
| verify | 메인 빌드체크 → **Workflow 도구** + 수렴 | ✅ | strength S=1/L=2 |
| test | **Test Agent팀** + 숙의(deliberation) | ✅ | strength S=1/L=2 |
| complete | 메인 단독 | — | — |

**결론**: forge-flow는 분석(clarify·plan)·구현(implement)을 **이미 Agent팀으로 병렬화**하고 **이미 S/M/L로 게이트**한다.
두 가지 오케스트레이션 메커니즘이 공존한다:

- **Workflow 도구** → review-req, review-plan, verify (검증 3단계)
- **Agent팀(TeamCreate+Agent)** → clarify, plan, implement, test

따라서 본 설계의 과제는 "병렬화 도입"이 아니라 **메커니즘 정합성 + 분해 정밀도**이다.

---

## 1. 핵심 설계 축 — Agent팀 vs Workflow 도구

두 메커니즘은 같은 "멀티에이전트 fan-out"이지만 보장이 다르다.

| 속성 | Agent팀 (TeamCreate+Agent) | Workflow 도구 |
|------|---------------------------|---------------|
| 에이전트 간 통신 | ✅ SendMessage (양방향) | ❌ 단방향 (반환값만) |
| 숙의/조정(deliberation) | ✅ 가능 | ❌ 불가 (스크립트가 조정) |
| 저널링/재개(resume) | ❌ 수동 | ✅ runId 캐시 재개 |
| 결정론적 제어흐름 | ❌ 프롬프트 의존 | ✅ pipeline/parallel/loop |
| worktree 격리 | 수동 | ✅ `isolation:"worktree"` |
| 토큰 예산 추적 | ❌ | ✅ `budget` |

### 1.1 단계별 권고 메커니즘

| 단계 | 현행 | 권고 | 이유 |
|------|------|------|------|
| clarify (탐색) | Agent팀 | **Workflow** (탐색 부분만) | 탐색은 독립·비대화형 → multi-modal sweep. 단 스펙확정·질문은 메인 잔류(§3) |
| plan (분석) | Agent팀 | **Workflow** | judge panel(계획 N안 생성·채점)·research fan-out 모두 비대화형. 결정론적 제어 이득 |
| **implement** | Agent팀 | **Workflow** (조건부) | **가장 큰 이득**: 저널링/재개 + 결정론적 wave + worktree 격리. §2 게이트 통과 시 |
| test | Test Agent팀 | **Agent팀 유지** | 테스터 간 숙의·AC×결과 매트릭스 조정에 SendMessage 필수. Workflow는 통신 불가 |

> **test는 의도적으로 Agent팀을 유지한다.** 테스트 숙의는 에이전트 간 양방향 통신이 본질이고 Workflow 도구로는 표현 불가하다. 마이그레이션 = "전부 Workflow"가 아니라 "비통신·재개가치 높은 곳만 Workflow".

---

## 2. 분해 게이트 — 휴리스틱에서 결정론으로 (핵심 보완)

### 2.1 현행 한계

현행 게이트는 **파일 수 휴리스틱**이다 (plan §2: 1-2=S / 3-10=M / 10+=L). 이는 규모는 재지만 **병렬 안전성**을 재지 못한다. 파일 10개라도 서로 강결합이면 병렬 구현 시 머지지옥·추상화 불일치가 난다.

### 2.2 보완 — 파일셋 기반 wave 분해 (GSD 차용)

각 work unit이 자기 파일 접근집합과 의존을 **선언**하게 한다.

```yaml
work_unit:
  id: WU-03
  writes: [src/api/order.ts, src/api/order.test.ts]   # 쓰기 집합
  reads:  [src/types/order.ts]                          # 읽기 집합
  depends_on: [WU-01]                                    # 명시적 선행
```

**병렬 안전 규칙** (결정론적):

> 두 work unit A, B가 동일 wave에서 병렬 실행 가능 ⟺ 아래 모두:
> `writes(A)∩writes(B)=∅` **그리고** `writes(A)∩reads(B)=∅` **그리고** `reads(A)∩writes(B)=∅` **그리고** 서로 `depends_on` 없음.
>
> ⚠️ read/write 비충돌 필수: writes만 비충돌이면 stale read(A가 B의 변경 전 파일을 읽음)가 **머지는 깨끗한데 코드는 틀린 무음 오류**를 낸다. 선언된 writes/reads 집합으로 직접 차단(추론 의존 금지). `depends_on`은 파일 외 논리 순서만 담당.

wave = 이 의존 DAG의 **위상 정렬 계층**. wave 내부는 병렬, wave 간은 순차.

이로써:
- "분해 가능한가?"가 **판단**에서 **계산**으로 바뀐다.
- implement Workflow가 wave별로 `parallel()` fan-out, wave 간 barrier.
- write-set 비겹침 보장 → worktree 격리 충돌 원천 차단.

### 2.3 게이트 통합 — 기존 S/M/L 대체 아닌 증강

파일 수 게이트는 **strength/리뷰 깊이** 결정에 유지(검증자 수, mid-review 필수 여부 등 이미 잘 작동).
파일셋 분해는 **구현 병렬화 여부·wave 구조** 결정에 신규 추가. 두 게이트는 직교한다.

```
plan §2:  파일 수 → S/M/L  → 리뷰 깊이·strength (현행 유지)
plan §3 신규:  work unit writes/reads/depends_on 선언 → wave DAG 계산
              → wave 1개 & 단일 unit  → 메인 단독 구현
              → wave 다수 or wave당 unit 다수  → implement Workflow fan-out
```

---

## 3. 하드 제약 — 대화형 경계

**Workflow 에이전트는 실행 중 사용자와 대화할 수 없다** (반환값만 통신). 따라서:

- **clarify의 Q&A** (요구사항 왕복 질문) → **메인 잔류**. 탐색(코드베이스 파악)만 Workflow로 분리.
- **사용자 승인 게이트** (규모 확정, 커밋 여부, REWORK 선택) → **전부 메인 잔류**.
- Workflow는 **비대화형 작업**(탐색·계획생성·구현·검증)에만 적용.

이것이 "왜 일부 단계가 순수 Workflow가 될 수 없는가"의 근본 이유다. 하이브리드(메인=대화·합성, Workflow=fan-out)가 정답이다.

---

## 4. 제안 플로우 (v5.1)

```
[user] /clarify
  ↓
clarify
  ├─ 탐색 fan-out         → Workflow (multi-modal sweep)   [신규: 팀→Workflow]
  └─ 스펙확정·사용자질문  → 메인 잔류                        [대화형 경계]
  ↓
review-req (Workflow)  — 현행 유지
  ↓
plan
  ├─ 계획생성 judge panel → Workflow (N안 생성·채점·합성)   [신규: 팀→Workflow]
  ├─ work unit writes/reads/depends_on 선언               [신규: 분해 선언]
  └─ wave DAG 계산 + 규모 확정                              [신규: 결정론 분해]
  ↓
review-plan (Workflow, L필수/M조건/S스킵)  — 현행 유지
  ↓
implement
  ├─ wave 1 & 단일 unit  → 메인 단독                        [현행 유지]
  └─ 다수 wave/unit      → Workflow fan-out + worktree격리  [신규: 팀→Workflow]
                          wave 내 parallel(), wave 간 barrier
                          + 4단계 reconciliation(머지 게이트)  [신규, §5.1]
  ↓
verify (메인 빌드 → Workflow + 수렴)  — 현행 유지
  ↓
test (Test Agent팀 + 숙의)  — 현행 유지 (Workflow 아님, 의도적)
  ↓
complete (메인)  — 현행 유지
```

---

## 5. 보조 보완 항목 (선택 — 우선순위 낮음)

> 본 항목들은 사용자가 요청한 "보완할 내용" 조사에서 superpowers/gsd가 잘하는 패턴이다.
> **핵심(§1~3)과 독립적**이며, 별도 채택 가능. 한꺼번에 도입해 rewrite-everything 되는 것을 경계한다.

### 5.1 fan-out 후 4단계 reconciliation (superpowers) — implement 병렬화와 함께 권장
implement Workflow가 wave를 병렬 실행한 뒤 **머지 게이트** 필수화:
1. 각 unit 요약 읽기 → 2. 편집 충돌 검사 → 3. 전체 빌드/테스트 함께 실행 → 4. 체계적 오류 spot-check.
write-set 비겹침(§2.2)이 1차 방어, reconciliation이 2차 방어.

### 5.2 격리 컨텍스트 서브에이전트 (superpowers)
구현 에이전트에 세션 히스토리 상속 금지. "plan 파일 읽어와" 대신 **task 전문을 프롬프트에 인라인 주입**. Workflow의 `agent(prompt)` 패턴과 정합.

### 5.3 decision-coverage 게이트 (gsd)
clarify의 각 요구사항 ID(REQ-NN/D-NN)가 plan의 work unit `must_haves`에 **최소 1회 매핑**되는지 review-plan에서 기계적 검사. 누락 요구사항 자동 탐지. 저비용·고효과.

### 5.4 verify 명령 plan-time 선언 (gsd "Nyquist")
각 work unit이 `verify: <command>` + 기대출력을 **plan 시점에** 선언. verify/test가 "즉흥 검증"에서 "선언된 명령 실행"으로 단순화. 테스트 인프라 없으면 wave-0 스캐폴딩 추가.

### 5.5 TDD를 plan 산출물에 내장 (superpowers)
work unit 검증방식이 `단위테스트-TDD`일 때 plan이 RED→GREEN 단계를 명시적 체크박스로 분해. 구현이 거의 기계적이 됨. (현행 plan §3-B에 검증방식 자동제안 이미 있음 — 이를 TDD 5단계로 확장)

---

## 6. 대상 베이스라인 & 착수 지점

- **현행 동작 기준**: 설치된 `5.0.0` 캐시 (`~/.claude/plugins/cache/forge-plugins/forge-flow/5.0.0`) — 읽기전용, 본 문서의 "현행" 근거.
- **dev 레포**: `/Users/dicepark/IdeaProjects/claude-tool-creator/claude-plugins/forge-flow` — 현재 `feature/verify-workflow-converge` (v4.0.3). **5.0.0과 불일치 — 동기화 필요.**
- **메모리의 `forge-flow-v5` 브랜치**: 현 체크아웃에 없음 (미페치 또는 타 레포). **착수 전 브랜치 정합성 확인 필수.**
- **구현 착수**: 위 베이스라인 일치 후 §2(분해 게이트) → §1.1 plan/implement 마이그레이션 순. test는 건드리지 않음.

---

## 7. 우선순위 요약

| 순위 | 항목 | 근거 | 위험 |
|------|------|------|------|
| **P0 ✅** | §2 파일셋 wave 분해 게이트 — **구현 완료(§8)** | 병렬 안전성을 판단→계산으로. 모든 implement 병렬화의 전제 | 낮음 (선언 추가) |
| **P1a ✅** | §1.1 plan 생성 Workflow화 (judge panel) — **구현 완료(§8)** | 저위험·즉시 이득. 대화형 경계 밖 | 낮음 |
| **P1b ✅** | §1.1 implement Agent팀→Workflow (게이트 뒤) — **구현 완료, git-spike 입증(§8)** | 저널링/재개+worktree. 단 §2 선행 필수 | 중 (머지) → 병합 메커니즘 spike 입증 |
| **P2 ✅** | §5.3 decision-coverage 게이트 — **구현 완료(§8)** | 저비용 traceability | 낮음 |
| **P2 ✅** | §5.4 verify 명령 plan-time 선언 — **기존 검증방식/검증기준 + 자동검증 플래그·wave-0(§8)** | verify 단순화 | 낮음 |
| P3 | §5.1/5.2/5.5 나머지 superpowers 패턴 | 점진 채택 | 낮음 |
| — | test Workflow화 | **하지 않음** — 숙의에 통신 필수 | — |

---

## 8. 구현 진척

### P0 — 파일셋 wave 분해 게이트 ✅ (plan/clarify SKILL, 미커밋)

**변경 파일**: `skills/plan/SKILL.md`, `skills/clarify/SKILL.md`

**핵심 결정 — 기존 인프라 증강(중복 금지)**:
- 기존 work unit 테이블에 이미 `의존`(depends_on) 컬럼·의존 그래프 자동도출·순환탐지 **존재** → 재사용.
- 신규 추가만: `변경 대상`(심볼 lump) → **`writes`/`reads` 파일 단위 분리**, **`wave` 컬럼**.
- 파일 수 S/M/L 게이트는 **리뷰 깊이·strength 결정에 유지**(직교). wave는 **구현 병렬화 구조 결정**에 신규.

**plan 3-B 분해 절차 재구성** (5→7 단계):
1. 분해 단위 → 2. 검증방식 자동제안 → **3. writes/reads 집합 도출(신규)** → 4. 의존 그래프(writes/reads 근거로 강화) → **5. wave 분해 결정론 계산(신규)** → 6. 사용자 승인 → 7. design 기록.

**wave 배정 알고리즘**(위상정렬 + 파일충돌 분리): 준비된 unit(의존 충족)을 현재 wave에 배정하되 wave 내 파일 충돌(쓰기-쓰기 OR 읽기-쓰기 양방향) 있으면 다음 wave로 보류 → wave 내 pairwise 파일 비충돌 보장. 같은 wave = 병렬 안전(worktree 격리 충돌 원천 차단).

**스키마 정합**: clarify의 design 포맷 정의(work units 표)도 동일 컬럼(writes/reads/wave)으로 갱신. verify의 단위검증 진입게이트는 named-column(`검증방식`) 파싱이라 무탈.

**독립성 단일진실 — 중복 제거**: 기존 plan에 병렬판정이 3곳(5단계 병렬가능성·7단계 판정트리·팀구성 분석) 각각 비형식 휴리스틱으로 산재 → 전부 **wave 결과 소비**로 일원화(독립성 재분석 금지). 구현자 수 = wave 최대 너비.

**알고리즘 검증(hand-trace 완료)**: ①happy path W0=[WU-1,WU-3]/W1=[WU-2]. ②adversarial — 쓰기충돌 형제: WU-4(의존 없음, WU-1과 writes 공유) → 의존 아닌 **파일충돌로 W1 분리** 확인. ③읽기공유: WU-2·WU-3 동일 파일 read-only → 충돌 아님. 보고 형식 예제에 ②③ 반영. 알고리즘 정상.

### P1a — plan 생성 Workflow화 (judge panel) ✅ (미커밋)

**변경 파일**: `workflows/plan-judge.js`(신규), `skills/plan/SKILL.md`(§3-0 호출 wiring)

- **관점별 독립 초안 fan-out**: MVP우선·리스크우선·패턴충실우선 각 독립 계획안 생성 → 병렬 judge(구현가능성·AC커버리지·범위절제·패턴일관성 4차원) → 최고안 + 차선안 이식 아이디어 합성 가이드 반환.
- **규모 게이트**: S 스킵(해법공간 좁음), M 선택(설계 분기 실재 시), L 필수. 초안 수 = {S:1, M:2, L:3}.
- **seam 계약 준수**: 워크플로는 초안·순위·합성가이드만 반환. 최종 design 작성·**wave 분해(3-B, 메인)**·상태전이는 메인. workUnits 초안의 writes/reads는 시드, wave는 비워 반환(메인이 P0 알고리즘으로 계산).
- verify.js 컨벤션 일치(방어적 args 파싱·fail-fast·scriptPath glob·throw=배선오류). `node -c` 통과.
- **✅ 라이브 입증** (`wf_1ecd5697`, 4 에이전트/75k/70s): clamp 함수 과제로 발동. 2 초안(MVP 20/20·리스크우선 19/20) **차등 채점**(judge가 리스크우선의 억측을 feasibility 4로 감점 — rubber-stamp 아님). synthesis가 차선안의 "min>max 계약 선확정" 아이디어 정확 이식. 가짜 explorationSummary 모순도 우아 처리(강건성).

### P1b — implement Agent팀→Workflow ✅ (미커밋, 메커니즘 git-spike 입증)

**병합 메커니즘 git-레벨 spike 입증**(Workflow 도구 불요로 검증): 2 격리 worktree(disjoint 파일)→각 커밋→순차 병합 **무충돌**(P0 disjoint 보장)→"전체 스위트 함께"(node -c 전 워크플로) PASS→feature 브랜치 불변. isolation:"worktree"는 같은 git 메커니즘 래퍼 + changelog 2.1.161 편집차단 버그 수정 확인 → 입증된 plain-git 위에 작성.

**변경 파일**: `workflows/implement.js`(신규), `skills/plan/SKILL.md`(에이전트팀 spawn 절차 → implement Workflow 호출로 rewire)

**설계** (Workflow 스크립트는 git 직접실행 불가 → 검증된 plain-git을 에이전트 Bash가 수행):
- **wave 순차, wave 내 구현자 병렬**: 각 구현자 = 격리 컨텍스트(unit 전문 인라인, 세션 히스토리 미상속 — superpowers 원칙). 자기 `git worktree`+브랜치 분기, **writes 목록만** 편집, `검증방식` 실행, 커밋, 브랜치명 반환.
- **wave 간 reconciliation 에이전트**: wave 브랜치들 통합 브랜치에 순차 병합(disjoint→clean) + **전체 스위트 함께 실행**(의미적 비양립 게이트) → 새 통합 ref 반환. **다음 wave가 그 위에 분기**(wave N+1이 wave N 결과 봐야 하므로 wave간 병합 필수).
- **의존 실패 전파**: unit FAIL/BLOCKED → 후속 wave의 그 unit 의존자 차단. verdict COMPLETE/PARTIAL/FAILED.
- **격리 정당화(정밀)**: source writes는 P0로 비충돌이나 같은 wave unit들의 `검증방식`(빌드/테스트) **동시 실행이 공유 빌드상태**(`target/`·`node_modules/`·`.pyc`) 경쟁. 격리는 *파일 편집* 아닌 **동시 빌드**용. reconciliation 충돌검사는 P0 덕에 trivial 단언; 진짜 게이트 = "전체 스위트 함께 실행".

**단위검증·의존 게이트 = 구조적**(advisor): reader in-memory 추적 불요 — wave가 독립성, dependsOn 전파가 의존실패, 각 구현자 검증방식이 단위검증 담당. seam: 워크플로는 요약만, 상태·verify전이는 메인. `node -c` 통과.

**✅ 라이브 e2e 입증** (`wf_44d6cd14`, 5 에이전트/92k/186s): 샌드박스 3-unit 과제(W0 add·mul 병렬 + W1 index 의존). 결과 verdict COMPLETE, blocked 0, 2 wave. **독립 실측 대조**: 통합 HEAD 41bd70d, 히스토리 clean(WU-1 ff→WU-2 merge→WU-3 ff), 3파일 병합, 실제 동작(add(2,3)=5·mul(4,5)=20), worktree 누수 0. **에이전트가 git 절차 정확 준수**(우려 핵심 해소): 격리 worktree 생성·disjoint 편집·검증방식 실행·커밋·브랜치 반환·순차 병합·전체 스위트 게이트·정리. **발견·수정**: 병합된 `impl/*` 브랜치 미삭제 → reconPrompt에 `git branch -d`(미병합 거부=안전) 추가.

### P2 — decision-coverage 게이트 + 자동검증 커버리지 ✅ (미커밋)

**변경 파일**: `skills/plan/SKILL.md` (3-B 승인 전 커버리지 게이트)

- **§5.3 AC→unit 커버리지 게이트(기계적)**: 승인 전 design `## 요구사항`의 모든 `AC-N`을 work unit `대상 AC` 합집합과 **집합 대조**(판단 아님). 누락 AC → **차단**·재분해. 역방향(AC 미매핑 unit) → 초과구현 경고. review-plan의 AC커버리지 렌즈(판단형)보다 **앞선 1차 기계 방어** — 누락을 워크플로 전에 결정론 차단.
- **§5.4 자동검증 커버리지(gsd Nyquist)**: forge-flow는 이미 `검증방식`+`검증 기준` 컬럼으로 plan-time verify 선언 보유. 추가: 로직 unit이 `수동`/`스킵`이면 플래그(강제 아님), 빌드명령 미설정 원인 시 **wave-0 스캐폴딩 unit** 제안.

**미검증(라이브)**: 실제 AC 파싱·누락 탐지 정확도 — 라이브 plan 실행 시.

### 잔여 보조 ✅ (미커밋)

- **§5.1 4단계 reconciliation 정식화**: implement.js reconPrompt를 superpowers 4단계로 — ①각 unit 요약 검토(병합 전, note 전달) ②편집충돌 검사=순차병합 ③전체 스위트 함께 ④**체계적 오류 spot-check**(unit 간 패턴 불일치·헬퍼 중복·시그니처 어긋남, disjoint write라도 의미 비양립). 기존엔 ②③만 → ①④ 추가.
- **§5.2 격리 컨텍스트**: implement.js implementer가 이미 unit 전문 인라인 + "세션 히스토리 미상속" 명시 — 충족.
- **§5.5 TDD-in-plan**: implement.js implPrompt에 검증방식=`단위테스트-TDD`면 **RED→GREEN→REFACTOR 순서 강제**(RED서 FAIL 미관측 시 BLOCKED). plan은 이미 TDD 검증기준 자동제안 보유 → 구현자 강제로 완결.

### 남은 일

- **전체 SKILL 관통 e2e** (clarify→complete): SKILL wiring + 워크플로 seam + 상태머신 + 핸드오프 통합 검증. 워크플로 단위는 입증됨(§8), 관통은 미검증.

---

*본 문서는 v5.0.0 실측 + superpowers/gsd 조사 기반. 핵심(§1~3)과 보조(§5) 분리. 대화형 경계(§3)가 일부 단계의 순수 Workflow화를 막는 근본 제약임을 명시. §8 = 구현 진척 로그.*
