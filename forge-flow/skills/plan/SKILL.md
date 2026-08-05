---
name: plan
description: "작업 계획 설계 — 검수 완료된 요구사항을 기반으로 구현 계획을 수립하고 확정 규모를 판정합니다. review-req 통과 후 자동 활성화."
---

검수 완료된 요구사항을 기반으로 구현 계획을 설계하고 확정 규모를 판정합니다.

## 선행 조건 검사

실행 전 반드시 확인:
1. 현재 세션에 바인딩된 상태 파일 탐색 → `.forge-flow/state/`에서 `session_id`가 현재 세션(`${CLAUDE_SESSION_ID}`)과 일치하는 `{task_id}.json` 파일 탐색 → 없으면: "워크플로가 시작되지 않았습니다. `/forge-flow:clarify`로 시작하세요."
2. design 문서의 `## 검수 결과`에 `review-req: PASS`가 있는지 확인 → 없으면: "요구사항 검수가 완료되지 않았습니다."

## 상태 파일 갱신

실행 시작 시:
```json
{ "phase": "planning", "stop_count": 0 }
```

## 실행 흐름

### 1단계: 기존 코드 분석

design 문서의 영향 범위를 기반으로 기존 코드를 상세 분석합니다.

1. **rework-log 참조**: `.forge-flow/rework-log.md` 존재 시 **전체 차원**을 스캔하여 이번 작업 영향 범위와 관련된 과거 REWORK 패턴 확인. 관련 패턴 발견 시 구현 계획의 주의사항 또는 리스크 항목에 반영
   - **충돌 체크**: rework-log 항목 중 이번 구현과 모순되는 항목이 있으면 (예: "var 사용 금지" 규칙이 있으나 이번 작업에서 var 호이스팅이 필요한 경우), design 문서에 `## rework-log 예외` 섹션을 추가하여 예외 사유를 명시. verify 검증자 프롬프트 구성 시 해당 항목을 주입에서 제외

2. **탐색 에이전트팀 호출 (규모 무관, 항상)**

   **2-a. 원칙**: 메인이 직접 LSP/grep/Glob으로 상세 분석을 하지 않는다. 규모 무관 **항상** 탐색 팀에 위임하여 요약만 리턴 받는다 (메인 컨텍스트 오염 방지).

   **2-b. 호출 내용**:
   - **탐색자(scout) 1명 (기본)**: 파일·심볼 탐색 + 영향 범위(호출 체인) + 기존 패턴(네이밍·에러처리·테스트) 분석을 단독 수행
   - **L 규모만**: Analyzer 1명 추가 (탐색자=파일 목록 / Analyzer=영향·패턴·리스크 분담)
   - 출력 포맷: **"plan 1단계 (상세)"** 블록을 리턴 받음
     ```
     [파일 목록]
     - path/to/file (L12-45)
     [영향 범위]
     <호출 체인 포함>
     [기존 패턴 요약]
     - 네이밍 / 에러 처리 / 테스트
     [리스크/주의사항]
     ```
   - Spawn 절차: `TeamCreate` → `TaskCreate` → `Agent(team_name, name, model:"sonnet")` → 메시지 수신 → `SendMessage(shutdown_request)` → `TeamDelete`
   - **상세 프롬프트 템플릿·폴백 정책·state 갱신은 `clarify/SKILL.md`의 `## 탐색 에이전트팀 (공통)` 섹션을 참조한다.**

   **2-c. rework 재실행 시 재사용 (AC-12)**: `rework_counts.plan > 0`인 재실행이면 기존 탐색 결과가 design 문서의 영향 범위·기존 패턴에 이미 반영되어 있다. **design 문서에 변경 범위 추가/변경이 없다면 탐색 팀 재호출을 생략**하고 기존 결과를 재사용. 변경 범위의 추가/변경이 있는 경우에만 재호출.

3. **코드 탐색** (팀 폴백 시에만 메인 직접 수행):
   - 팀 호출 실패(clarify/SKILL.md 폴백 정책 참조) 시에만 메인이 직접 수행
   - LSP 사용 가능 시 → 참조 검색, 타입 확인, 호출 체인 추적
   - LSP 없으면 → grep + Glob으로 폴백
4. **변경 전파 체인 파악**:
   - 이 변경이 어디까지 영향을 미치는가?
   - 공유 상태(DB 스키마, API 계약, 이벤트) 변경 여부
   - `.forge-flow/config.json`의 `propagation_chain` 필드 참조 (있는 경우)
5. **기존 코드 패턴 파악**:
   - 영향 범위 내 기존 코드의 패턴을 분석하여 구현 시 따를 패턴을 식별
   - 분석 항목: 네이밍 컨벤션, 에러 처리 방식, 파일/폴더 구조, import 순서, 로깅 패턴, 테스트 작성 방식
   - **별도 요청이 없으면 기존 패턴을 그대로 따름** — 더 나은 패턴이 있더라도 일관성 우선
   - 기존 패턴을 변경하려면 사용자 승인 필요 (리팩토링 요청 등)

### 2단계: 확정 규모 판정

변경 파일 목록이 구체화된 시점에서 **증거 기반 판정**:

| 규모 | 기준 | 근거 형식 (필수) |
|------|------|----------------|
| **S** | 변경 파일 1-2개, 기존 패턴 내 수정, 새 의존성 없음 | `영향 파일: src/config/app.yml (1개)` |
| **M** | 변경 파일 3-10개, 기존 로직 수정, 테스트 필요 | `영향 파일: src/auth/*.java (4개), test/auth/*.java (3개)` |
| **L** | 변경 파일 10+, 아키텍처 변경, 모듈 간 영향 | `영향 파일: 3개 모듈 15개 파일 (목록)` |

**반드시 구체적 파일 경로를 근거로 제시합니다.**

확정 판정이 예비 판정과 다른 경우 → 사용자에게 알리고 워크플로 조정:
```
[규모 변경] 예비 M → 확정 L
근거: 변경 파일 12개, 3개 모듈에 걸쳐 영향
→ 에이전트팀 구성을 권장합니다.
```

### 2.5단계: 분할 판정 — chunk 모드 (M/L)

확정 규모가 M/L이면, 전체를 한 번에 계획·구현·검수하는 대신 **검증 가능한 S-등가 chunk 열로 분할**할 수 있는지 판정한다.

> **근거**: L 일괄 진행은 design·diff가 비대해져 검수 장기화 + REWORK 비수렴(검증자가 매번 대형 diff 전체를 재평가). chunk 분할은 diff·검증 컨텍스트를 작게 유지해 수렴이 빠르고, 결함이 chunk 경계 안에 갇힌다.

**chunk 기준 (S-등가)** — 각 chunk가 모두 충족:
- AC 1~2개 담당. 모든 AC는 정확히 하나의 chunk에 귀속 (커버리지 게이트와 동일한 집합 대조로 확인)
- 변경 파일 ≤ 3 (writes 기준)
- **독립 검증 가능**: chunk 완료 시점에 실행/관찰 가능한 검증 기준 존재 (뒤 chunk 완성을 전제하지 않음)
- 선행 chunk 산출물에만 의존 (의존 그래프 위상 정렬 순서 준수)

**분할 절차**: 1단계 탐색 요약(파일·호출 체인)을 근거로 AC를 위상 정렬 → 순서대로 위 기준을 만족하는 최소 묶음으로 그리디 분할. **가능한 것까지만** — 강결합이라 못 쪼개는 AC 군은 하나의 잔여 chunk로 묶는다(잔여 chunk는 기준 초과 허용, 표에 ⚠ 표시).

**AC 하위 분해 (큰 AC 처리)**: 단일 AC가 chunk 기준을 초과하면(변경 파일 4+ 등) 잔여 chunk로 보내지 말고 **하위 AC로 분해**한다 — `AC-N` → `AC-N.1`, `AC-N.2` … (각각 독립 검증 가능한 조건으로). design `## 인수 조건`을 갱신: 원 AC 아래 하위 AC 목록 기재, 원 AC는 "하위 AC 전체 충족 시 충족"으로 재정의.
- **하위 분해 시 경량 요구 재검증 (필수)**: AC 변형은 요구사항 산출물 변경이므로, `review-req.js`를 **분해분만** 대상으로 1회 재호출한다 — args: `lightweight: true`, `designDoc`: 원 AC + 하위 AC 목록 + 관련 영향범위 발췌만, `perspectives` 오버라이드:
  `["분해 보존성: 하위 AC의 합집합이 원 AC의 의미를 완전 보존하나(누락된 조건·약화된 검증 기준 없나), 각 하위 AC가 독립적으로 검증 가능한 구체 조건인가"]`
  REWORK면 재분해 후 재검증. PASS 후 하위 AC를 chunk 귀속 대상으로 사용. (풀 review-req 재실행 아님 — 원 AC들은 이미 검수 통과, 분해분만 검증.)

**실행 순서 결정**: chunks[] 배열 순서 = 실행 순서. 규칙:
1. **의존 제약 절대 우선** (위상 정렬 위반 불가).
2. 동순위 자유 슬롯은 ① 사용자 지정 우선 AC가 속한 chunk → ② 연결고리를 많이 공급하는 chunk(후속 영향 큰 계약 먼저 실물화 = 리스크 조기 소진) → ③ 나머지.
3. 승인 질문에서 사용자가 순서 조정 가능 (의존 위반 조정 요청 시 사유와 함께 거부).

**진행 중 순서 변경·재분할 프로토콜**: 사용자가 순서 변경/chunk 추가·제거를 요청하면 —
- 순서 변경: 대상 chunk의 의존이 모두 `done`인지 검사 → 충족 시 chunks[] 재배열, 미충족 시 사유 보고.
- 범위 변경(chunk 추가·제거·경계 이동): 경계표 갱신 → **분할 품질 게이트 재검사** → AC 변형이 있으면 위 경량 요구 재검증 → 재승인. `done` chunk는 불변(이미 커밋·검증 완료), 변경은 pending에만.

**연결고리(interface) 도출** — chunk 간 계약을 명시한다:
- chunk N의 연결고리 = **선행 chunk들의 writes ∩ chunk N의 reads** (파일 단위) + 그 파일에서 소비하는 **심볼 시그니처**(함수/타입/API 계약).
- 도출 근거는 탐색 요약의 호출 체인. 추정 불가 시 사용자에게 질문(빈 칸으로 승인 진행 금지).
- 연결고리는 **후속 chunk가 전제하는 계약**이므로, 선행 chunk의 검증 기준에 해당 인터페이스 검증이 포함돼야 한다(예: C1 검증 기준에 "export 시그니처가 경계표와 일치" 포함).

**분할 품질 게이트 (기계 검사 — 승인 질문 전 필수)**: 판단이 아닌 집합 대조. 하나라도 걸리면 재분할 후 재검사:
1. **AC 전단사**: 모든 AC가 정확히 하나의 chunk에 귀속 (누락·중복 귀속 → 차단).
2. **파일 겹침 = 의존 강제**: 두 chunk의 writes가 같은 파일을 포함하면 반드시 둘 사이 의존 순서 존재 (없으면 경계 재조정 — 순서 없는 동일 파일 쓰기는 chunk 커밋 diff 경계를 오염).
3. **의존 ↔ 연결고리 정합**: 의존이 선언됐는데 연결고리가 공란이면 의심 플래그(왜 의존?) / 연결고리가 있는데 의존 미선언이면 차단(순서 위반 시 stale 계약).
4. **검증 기준 실행 가능성**: 각 chunk 검증 기준이 그 시점까지 커밋된 코드만으로 실행 가능한가 (뒤 chunk 산출물 참조 시 차단).

**판정**: chunk 2개+ 도출 → 게이트 통과 후 아래 승인 질문. chunk 1개(분할 불가) → 기존 일괄 흐름(3단계)으로.

**AskUserQuestion 호출** (chunk 2+일 때 1회):
```
question: "작업을 {N}개 chunk로 분할해 chunk마다 계획→구현→검수를 반복할까요? chunk PASS마다 기능 브랜치에 자동 커밋됩니다."
header: "분할 진행"
options:
  - label: "분할 진행 (Recommended)"
    description: "chunk 경계표대로 순차 진행 — 작은 diff 단위 검수, 빠른 수렴"
  - label: "일괄 진행"
    description: "기존 M/L 흐름 (전체 계획 → 전체 구현 → 전체 verify)"
multiSelect: false
```

**승인 시 기록**:
1. design `## 구현 계획`에 **chunk 경계표만** 작성 (상세 계획은 각 chunk 착수 시 JIT):

```markdown
### chunk 경계표
| chunk | 대상 AC | 파일 경계 (writes) | 연결고리 (선행 계약 소비) | 검증 기준 | 의존 |
|-------|---------|-------------------|------------------------|----------|------|
| C1 | AC-1 | src/a.ts | (없음) | `npm test a` PASS + export 시그니처 `parseFoo(x: Raw): Foo` 일치 | (없음) |
| C2 | AC-2, AC-3 | src/b.ts, src/b.test.ts | src/a.ts: `parseFoo(x: Raw): Foo` | `npm test b` PASS | [C1] |
```

2. 상태 파일에 chunk 큐 기록 (배열 순서 = 실행 순서):
```json
{ "chunk_mode": true, "current_chunk": "C1",
  "chunks": [
    { "id": "C1", "acs": ["AC-1"], "status": "pending", "commit": null },
    { "id": "C2", "acs": ["AC-2"], "status": "pending", "commit": null }
  ] }
```
> `status`: `pending`(대기) / `in_progress`(JIT 계획~구현 중) / `rework`(chunk verify REWORK 수정 중) / `done`(verify PASS + 커밋 완료). `commit`: PASS 시 커밋 해시 — 다음 chunk verify의 diff base이자 세션 재개 시 진행 재구성 근거 (verify SKILL이 기록).

**chunk 모드에서의 후속 단계 변경** (아래 각 단계 본문보다 우선):
- **3-0 plan-judge: 스킵** — chunk = S 등가, 해법 공간 좁음.
- **3단계 상세 계획: chunk별 JIT** — 착수하는 chunk에 대해서만 design에 `### chunk 계획: {id}` 하위 섹션(따를 패턴·변경 순서·검증 방법, 10줄 내외)을 작성. 전체 상세 계획을 미리 만들지 않는다.
  - **연결고리 실측 원칙 (필수)**: 선행 chunk가 있으면 JIT 계획 작성 전 **커밋된 실제 코드에서 연결고리 인터페이스를 직접 읽어**(Read/Grep) 시그니처를 확인하고 계획에 인용한다. 경계표의 계약과 실제 코드가 다르면(선행 chunk가 계약과 다르게 구현) → 즉시 보고: 경계표 갱신 + 영향 후속 chunk 재검토. **경계표 기억이나 추측으로 계획 금지** — 순차 chunk의 장점은 선행 산출물이 실물이라는 것.
- **3-B work unit 분해: 스킵** — chunk 경계표의 writes/검증 기준이 unit 역할을 대체. implement.js fan-out 불사용, chunk는 메인 단일 세션 구현이 기본.
- **review-plan: 경계표에 대해 1회만** — **호출 시점 = plan 완료 직후·첫 chunk 착수 전** (L 필수·M 조건 판정은 기존과 동일). chunk별 JIT 계획·통합 verify 후에는 호출하지 않음. chunk별 JIT 계획은 S 취급으로 검수 생략. 호출 시 args에 **분할 검증 관점을 오버라이드**한다 (review-plan SKILL §4의 chunk 모드 관점 참조 — 경계 적절성·연결고리 완전성·검증 기준 독립성).
- **4단계 검증 설정: 축소** — chunk verify는 강도 1·수렴 1 고정(4-A/4-B 질문 생략). 통합 verify 강도는 규모 기본(M=1/L=2) 자동. 질문은 테스트 방식(4-C) + TDD(4-D)만 남으며 1회 AskUserQuestion에 묶는다.
- **구현·검수 루프**: verify SKILL의 `## chunk 모드` 절차를 따른다 — chunk JIT 계획 → 구현 → chunk diff만 verify(lightweight) → PASS 시 자동 커밋 + 다음 chunk → 전 chunk 완료 시 통합 verify(전체 diff) → test 1회 → complete.

### 3단계: 구현 계획 작성

> **chunk 모드면 이 단계는 chunk 착수 시마다 해당 chunk에 대해서만 축약 실행** (2.5단계 참조). 이하 본문은 일괄 흐름 기준.

#### 3-0단계: 계획안 생성 — judge panel (L 필수 · M·S 기본 스킵 · chunk 모드 스킵)

복잡한 작업은 메인이 단일 계획을 즉흥 작성하는 대신, **관점별 독립 계획안을 fan-out**하여 채점·합성한다(해법 공간이 넓을 때 단일 시도보다 우수). 비대화형이므로 Workflow로 위임한다(§대화형 경계 밖).

**규모별 적용**:
- **S 규모**: **스킵**. 메인이 단일 계획 직접 작성(해법 공간 좁음, fan-out 비용 낭비).
- **M 규모**: **기본 스킵**. 메인이 단일 계획 직접 작성. 단 사용자가 **명시적으로 설계 대안 비교를 요청**한 경우에만 호출(opt-in). (근거: rework-log 실측상 plan-judge 기여 결함 0건 — 기본 비용만 발생하므로 M 기본값을 스킵으로 전환. L은 해법 공간이 넓어 유지.)
- **L 규모**: **필수**.

**호출** (스킵 아닐 때):
1. `Workflow` 도구를 `scriptPath`로 호출 — robust glob 1순위:
   `marketplaces/*/forge-flow/workflows/plan-judge.js` (count=1 확인; 다중 매치 시 `$CLAUDE_PLUGIN_ROOT/workflows/plan-judge.js` 폴백).
2. `args` 주입 (객체; 워크플로가 JSON 문자열로 받아 방어 파싱):
   - `taskId`, `scale`
   - `acList`: design `## 요구사항`/AC 발췌
   - `patternsExcerpt`: 1단계 탐색 팀의 `[기존 패턴]` 요약
   - `explorationSummary`: 1단계 탐색 팀 출력 전체(`[변경 대상 파일]`/`[영향 범위]`/`[기존 패턴]`/`[리스크]`) — **저장소 실재 근거**(추측 차단)
   - `projectContext`: CLAUDE.md 스택/구조 ≤3줄
   - `reworkLogExcerpt`: rework-log `[계획]`/`[코드]` ×2+ 발췌
3. **반환**: `{ recommended, bestAngle, drafts:[{idx,angle,summary,changeFiles,sequence,risks,workUnits,scores,note}], synthesisGuidance }`.
4. **메인이 합성**: `recommended` 초안을 기반으로 `synthesisGuidance`의 이식 아이디어를 검토·접목하여 아래 `## 구현 계획` 섹션을 작성한다. **work units는 초안의 것을 시드로 쓰되 writes/reads/의존을 확정하고, wave는 3-B 5단계에서 메인이 결정론 계산**(워크플로는 wave를 비워 반환).
5. **throw 처리**: status=failed 또는 반환에 `drafts` 부재 → 배선 오류(args 누락 점검·재호출). 2연속 throw = 보고·중단. judge panel 없이도 메인이 단일 계획 작성으로 진행 가능(저하 모드).

> **seam 계약**: 워크플로는 계획 *초안·순위·합성가이드*만 반환. 최종 design 작성·wave 분해·상태 전이는 메인. verify/review-* 워크플로와 동일 분리.

#### 3-1단계: 최종 구현 계획 작성

design 문서의 `## 구현 계획` 섹션에 추가(judge panel 적용 시 위 합성 결과 반영):

```markdown
## 구현 계획

### 따를 기존 패턴
| 항목 | 기존 패턴 | 근거 파일 |
|------|---------|----------|
| 에러 처리 | ErrorHandler.wrap() 사용 | src/auth/LoginService.java:45 |
| 네이밍 | camelCase, Service 접미사 | src/auth/AuthService.java |
| 테스트 | @DisplayName + given_when_then | test/auth/AuthServiceTest.java |

> 위는 예시입니다. 실제 프로젝트의 패턴을 분석하여 작성합니다.
> 기존 패턴과 다른 방식으로 구현해야 할 경우 `리스크 항목`에 명시합니다.

### 변경 대상 파일
| 파일 | 변경 내용 | 우선순위 |
|------|---------|---------|
| src/auth/LoginService.java | 소셜 로그인 프로바이더 추가 | 1 |
| src/auth/SocialAuthProvider.java | 신규 생성 | 1 |
| test/auth/LoginServiceTest.java | 소셜 로그인 테스트 추가 | 2 |

### 변경 순서
1. SocialAuthProvider 생성 (독립, 의존성 없음)
2. LoginService에 프로바이더 연동
3. 테스트 작성 + 검증

### 리스크 항목
- OAuth 콜백 URL 설정 필요 (환경변수)
- 기존 세션 관리 로직과의 통합 검증 필요

### 테스트 계획 (TDD 순서)

구현 시 RED-GREEN-REFACTOR 순서를 따릅니다:

| # | RED (실패 테스트 먼저) | GREEN (최소 구현) | 검증할 동작 |
|---|---------------------|------------------|------------|
| 1 | test/SocialAuthProviderTest | SocialAuthProvider | Google 토큰 → JWT 변환 |
| 2 | test/LoginServiceIntegrationTest | LoginService 연동 | 신규 사용자 자동 가입 |

> **원칙**: 실패 테스트 작성 → RED 확인 → 최소 구현 → GREEN 확인 → REFACTOR. 구현 코드 먼저 작성 금지.
> 테스트 불가능한 항목(환경 설정, 설정 파일)은 TDD 대상에서 제외하되 명시적으로 표기.

### 검증 방법
| AC | 검증 방식 | 도구/명령 |
|---|---------|----------|
| AC-1 | 빌드 성공 확인 | ./gradlew build |
| AC-2 | API 엔드포인트 테스트 | curl POST /auth/google → 200 + JWT |
| AC-3 | 브라우저 UI 확인 | Playwright로 로그인 플로우 검증 |

> 위는 예시입니다. 각 AC별로 verify/test에서 **어떤 방식으로 검증할지** 사전에 합의합니다.
> 이 테이블은 verify 검증자와 test 테스터에게 전달되어 검증 누락을 방지합니다.

### work units (M/L 규모만 — S 규모는 본 섹션 생략)

| id | 제목 | 대상 AC | writes (변경 파일) | reads (참조 파일) | 검증방식 | 검증 기준 | 의존 | wave |
|----|------|---------|-------------------|------------------|---------|---------|------|------|
| WU-1 | <unit 제목> | AC-1 | <쓰기 파일 경로 목록> | <읽기 파일 경로 목록> | 단위테스트 / 수동 / 스킵(사유) | <PASS 판단 명령 또는 조건 — 예: `./gradlew test FooTest`, "화면에 X가 표시됨"> | (없음) 또는 [WU-id, ...] | W0 |

> **work unit = 구현 중 단위검증 게이트의 단위 + 병렬 실행 단위.** 자세한 분해·검증방식·의존·wave 도출 절차는 본 SKILL의 **3-B단계** 참조.
> - **writes/reads = 파일 단위 접근 집합** (심볼 아닌 파일 경로). 병렬 안전성·의존 추론·검증자 컨텍스트의 근거.
> - **wave = 병렬 실행 계층.** 같은 wave의 unit은 병렬 안전(동시 구현 가능), wave 간은 순차. 도출 규칙은 3-B 5단계 참조.
> - **단위검증 게이트(순차)**: implement는 의존 후속 unit 착수 직전 직전 unit의 검증방식을 실행하여 PASS면 진행, FAIL이면 의존 후속 unit 차단(독립 unit은 계속). wave(병렬)와 직교 — wave는 *동시 착수 가능 여부*, 단위검증은 *착수 전 선행 PASS 요건*.

```

> 중간 검수(구 task별 Spec compliance 리뷰·50% 중간 검수)는 **v5.2.3에서 폐지** — implement 워크플로의 wave별 reconciliation(④ 체계적 오류 spot-check)과 verify 게이트가 그 역할을 대체한다. chunk 모드에서는 chunk verify가 동일 역할.

### 3-B단계: work unit 분해 + 검증방식·의존 그래프 자동 제안 (M/L 규모)

3단계의 구현 계획 작성 직후, 작업을 work unit으로 분해하여 구현 중 단위검증 게이트의 기준을 사전에 합의합니다.

**규모별 적용**:
- **S 규모**: 본 단계 **전체 생략**. plan은 work unit 섹션을 design에 추가하지 않으며, implement는 기존 흐름을 따른다.
- **M 규모**: 권장. 사용자가 일괄 승인 시점에 비활성화 가능.
- **L 규모**: 필수. 모든 unit이 검증방식을 가져야 하며, 스킵 시 사유 기재 필수.

#### 분해 절차 (M/L 규모)

1. **분해 단위**: design의 AC를 1차 기준으로 work unit을 도출한다. 1 AC = 1+ unit 매핑이 유지되어 모든 AC가 최소 하나의 unit에 귀속되도록 한다. 한 AC가 너무 크면 plan이 하위로 쪼갤 수 있다.
   - **분해 결과 work unit이 0개**(AC가 너무 사소해 분해 불필요)이면 단위검증을 비활성화하고 사용자에게 통지한 뒤 본 단계를 종료한다.

2. **검증방식 + 검증 기준 자동 제안**: 각 unit에 대해 plan은 아래 우선순위로 검증방식을 자동 제안하고, **검증 기준(PASS 판단 조건)을 구체적으로 함께 명시**한다.
   - `.forge-flow/config.json`의 `build_commands` 필드가 미설정이면 → `스킵(빌드 명령 미설정)` / 검증 기준: `—`
   - **TDD on이고** 변경 대상이 자동화 테스트 가능한 로직 코드(서비스/유틸/스킬 로직 등)이면 → `단위테스트-TDD` / 검증 기준: RED 단계 기록(실패 테스트 + 실행 결과 FAIL) + GREEN 단계(테스트 PASS) + REFACTOR 단계(코드 정리, 테스트 PASS 유지)
   - **TDD off이고** 변경 대상이 자동화 단위테스트로 검증 가능한 코드이면 → `단위테스트` / 검증 기준: 실행 명령 + 기대 결과 (예: `./gradlew test FooTest` PASS)
   - 변경 대상이 **인프라 변경**(plugin.json/marketplace.json 수정, 디렉토리 삭제·이동, CHANGELOG·메타데이터 작성, 단순 문서 편집 등)이면 TDD on/off 무관하게 → `스킵(인프라 변경 — TDD 부적합)` / 검증 기준: 결과 파일 존재 + 형식 검증(jq/diff/grep). plan은 인프라 unit을 자동 분류하여 일괄 스킵 후 사용자에게 일괄 승인을 받는다.
   - 변경 대상이 마크다운/JSON/설정 파일이거나 UI/통합이 필요하면 → `수동` / 검증 기준: 사용자가 눈으로 확인할 조건 (예: "화면에 목록이 표시됨")
   - 그 외 → `스킵(사유)` 사유 명시 / 검증 기준: `—`
   > **검증 기준 원칙**: "잘 동작한다"처럼 모호한 표현은 금지. 구현자가 실행하거나 관찰할 수 있는 **단일 구체 조건**으로 작성한다.
   > **TDD 토글**: 4단계 검증 설정에서 `TDD on/off`를 결정. 기본값 off, 사용자 명시 시 on. on이면 모든 로직성 unit 기본값 `단위테스트-TDD`, off면 `단위테스트`. 인프라 unit은 토글 무관 항상 `스킵`.

3. **writes/reads 집합 도출**: 각 unit에 대해 plan은 1단계 탐색 팀 출력(`[영향 범위]`, `[변경 대상 파일]`)을 근거로 **파일 단위** 접근 집합을 채운다.
   - **writes** = 이 unit이 생성·수정·삭제하는 파일 경로 목록. 심볼이 아니라 **파일** 단위(같은 파일 내 다른 심볼도 같은 writes 원소).
   - **reads** = 이 unit이 구현 시 읽어야 하는(변경하지 않는) 파일 경로 목록. 의존 추론·검증자 컨텍스트 주입의 근거.
   - writes가 비면 안 됨(변경 없는 unit은 unit이 아님). 추정 불가 시 사용자에게 질문.

4. **의존 그래프 자동 도출**: writes/reads + 탐색 팀의 호출 체인을 근거로 plan이 unit 간 **논리 의존**을 추론한다. unit A의 reads가 unit B의 writes와 겹치거나(A가 B의 산출물을 입력으로 사용), A의 동작이 B의 변경 결과를 전제하면 A는 B에 의존한다.
   - **순환 참조 탐지**: 의존 그래프에 순환이 발견되면 plan은 즉시 사용자에게 보고하고 unit 재분해를 제안한다(승인 단계로 진행하지 않음).

5. **wave 분해 (병렬 안전성 결정론 계산)**: 의존 그래프 + writes 집합으로부터 병렬 실행 계층(wave)을 **계산**한다. "분해 가능한가?"를 판단이 아닌 계산으로 만드는 핵심 단계.

   **병렬 안전 규칙** (두 unit A, B가 동일 wave에서 병렬 실행 가능 ⟺ 아래 **모두** 충족):
   - **쓰기-쓰기 비충돌**: `writes(A) ∩ writes(B) = ∅` — 같은 파일을 쓰면 worktree 병합 충돌.
   - **읽기-쓰기 비충돌(양방향)**: `writes(A) ∩ reads(B) = ∅` **그리고** `reads(A) ∩ writes(B) = ∅` — 한쪽이 쓰는 파일을 다른쪽이 읽으면 stale read(A가 B의 변경 전 X를 읽음). **writes만 비충돌이면 머지는 깨끗해도 코드는 틀림 = 무음 오류** → 반드시 선언 집합으로 직접 차단.
   - **무의존**: A와 B 사이에 (이행적) `depends_on` 관계 없음.

   > **핵심**: 앞 3개는 **선언된 writes/reads 집합만으로 결정론 계산**(추론 아님). `depends_on`은 파일 외 논리 순서(예: "마이그레이션 후 테스트")만 담당. "판단→계산" 주장의 근거 = wave는 선언집합의 교집합 연산이라 결정론적, 추론은 *입력*(writes/reads 채우기)에만 존재.

   **wave 배정 알고리즘** (위상 정렬 + 쓰기 충돌 분리):
   1. `W ← 0`. 미배정 unit 집합 `U ← 전체 unit`.
   2. **준비된 unit** = `U` 중 모든 의존이 `W`보다 앞선 wave에 이미 배정된 unit.
   3. 준비된 unit을 순서대로 현재 wave `W`에 배정하되, **이미 `W`에 배정된 어떤 unit과 파일 충돌**(쓰기-쓰기 OR 읽기-쓰기 양방향, 위 안전 규칙)**이 있으면** 그 unit은 보류(다음 wave로). → 한 wave 내 모든 unit은 pairwise 파일 비충돌 보장.
   4. `W`에 1개 이상 배정됐으면 `W ← W+1`, `U`에서 배정분 제거, 2로. 0개 배정인데 `U`가 남으면 순환(4단계서 이미 차단됐어야 함) → 오류 보고.
   5. `U`가 비면 종료. 각 unit의 `wave` 컬럼(W0, W1, …)을 채운다.

   **결과 해석**:
   - wave가 1개(전부 W0)이고 unit이 1개 → implement 메인 단독(병렬 불필요).
   - wave 다수 또는 한 wave에 unit 2개+ → implement가 **wave별 병렬 fan-out**(같은 wave 동시, wave 간 순차). worktree 격리는 쓰기 비충돌이 보장하므로 안전.
   - **단위검증 게이트(순차)와 직교**: wave는 동시 착수 가능 여부, 단위검증은 착수 전 선행 unit PASS 요건. 같은 wave라도 의존 있는 후속은 없음(의존=다른 wave); wave 내 unit은 서로 독립이므로 단위검증 순서 무관.

**커버리지 게이트 (기계적 — 승인 전 필수)**:

승인 전, plan은 **판단이 아닌 집합 대조**로 AC 누락을 차단한다(gsd decision-coverage). review-plan의 AC커버리지 렌즈(판단형)보다 앞선 1차 기계 방어.

- **AC→unit 커버리지**: design `## 요구사항`의 모든 `AC-N`을 수집 → work unit `대상 AC`의 합집합과 대조. **어떤 unit에도 귀속 안 된 AC** 발견 시 → **차단**. 누락 AC 목록 보고 + unit 재분해(승인 단계 진행 금지). (역방향: 어떤 AC에도 매핑 안 된 unit은 초과구현 의심 → 경고.)
- **자동검증 커버리지** (gsd Nyquist, 보조): 로직 코드 unit(서비스/유틸/스킬 로직)인데 검증방식이 `수동`/`스킵`이면 **플래그**(자동 검증 부재 경고, 강제 차단 아님 — 일부 로직은 진짜 수동 필요). 원인이 **빌드/테스트 명령 미설정**이면 → **wave-0 스캐폴딩 unit** 제안(테스트 인프라를 우선 구성하고 로직 unit이 그에 의존하도록 wave 재계산).

```
[커버리지 게이트]
AC 커버리지: AC-1✓ AC-2✓ AC-3✗(누락) → 차단, 재분해 필요
자동검증: WU-3(로직, 수동) ⚠ 자동검증 부재  |  빌드명령 미설정 → wave-0 스캐폴딩 제안
```

6. **사용자 일괄 승인** (`AskUserQuestion`):

```
question: "도출된 work unit과 검증방식·의존 그래프를 승인할까요?"
header: "work unit 승인"
options:
  - label: "일괄 승인 (Recommended)"
    description: "위 표 그대로 진행합니다"
  - label: "개별 조정"
    description: "특정 unit의 검증방식이나 의존을 조정합니다"
  - label: "비활성화 (M 규모만)"
    description: "본 작업에서는 단위검증 게이트를 적용하지 않습니다"
multiSelect: false
```

> L 규모는 "비활성화" 선택지를 제거한다(필수).
> "개별 조정" 선택 시 사용자가 표를 직접 수정한 뒤 재승인. "비활성화" 선택 시 design `### work units` 섹션을 생성하지 않음(AC-10 하위 호환과 동일하게 동작).

7. **승인된 결과를 design에 기록**: design `## 구현 계획` 하위에 `### work units` 표(wave 컬럼 포함)를 작성한다(clarify의 design 포맷 참조).

#### 도출 보고 형식

```
[work unit 도출]
규모: {M/L}, 분해 단위: {N}개, wave: {W}계층 (병렬도 {최대 동시 unit 수})

| id | 제목 | 대상 AC | writes | reads | 검증방식 (자동 제안) | 검증 기준 | 의존 | wave |
|----|------|---------|--------|-------|------------------|---------|------|------|
| WU-1 | ... | AC-1 | docs/list.md | — | 수동 (마크다운 편집) | "목록에 항목 표시됨" | (없음) | W0 |
| WU-2 | ... | AC-2 | src/svc/foo.ts, src/svc/foo.test.ts | src/types/foo.ts | 단위테스트 (서비스 로직) | `./gradlew test FooTest` PASS | [WU-1] | W1 |
| WU-3 | ... | AC-3 | src/svc/bar.ts | src/types/foo.ts | 단위테스트 | `... BarTest` PASS | (없음) | W0 |
| WU-4 | ... | AC-1 | docs/list.md | — | 수동 | "각주 추가됨" | (없음) | W1 |

순환 참조: 없음
wave 분해: W0 = [WU-1, WU-3], W1 = [WU-2, WU-4]
  - W0: WU-1·WU-3 병렬 안전(writes 비충돌 `docs/list.md`≠`src/svc/bar.ts`, 무의존)
  - W1: WU-2는 **의존**(WU-1)으로 분리. WU-4는 **의존 없지만 쓰기충돌**(WU-1과 `docs/list.md` 공유)으로 W0 불가 → W1 분리. ← 비자명: 의존 아닌 파일충돌도 wave를 가른다
  - 읽기-쓰기 점검: WU-2·WU-3가 `src/types/foo.ts`를 **둘 다 read**(write 아님) → 충돌 아님, 같은 wave 무관
implement 권고: wave 2계층, 최대 너비 2 → 구현자 2명, W0 동시 2 unit → W1
```

### 4단계: 검증 설정

확정 규모를 기반으로 검증 강도, 수렴 라운드, 테스트 방식을 설정합니다.

> **질문 묶음 (필수)**: 4-A/4-C/4-D 질문은 **AskUserQuestion 1회 호출에 묶는다** (1회 호출 최대 4질문 — clarify 3단계와 동일 규칙). 4-B(수렴)는 강도 답변에 조건부이므로 강도 2+ 선택 시에만 후속 1회. 순차 4회 호출 금지 — 사용자 왕복이 워크플로 최대 병목.
> **질문 생략 규칙**: ① 4-A0 `lightweight=true` 판정 시 4-A/4-B 생략 (워크플로가 강도 1을 강제하므로 질문해도 무시됨 — 모순 방지). ② chunk 모드(2.5단계)면 4-A/4-B 생략 (chunk verify 1/1 고정, 통합 verify 규모 기본).

#### 4-A0: 경량(lightweight) 판정 — 비용 floor (규모와 직교)

규모(크기)와 별개로 **복잡도/위험**을 판정한다. 저위험 trivial 과제에 풀 fan-out 검증(관점 복수 + completeness critic + 다수 refuter)은 **과잉 프로비저닝**(실측: 4파일 유틸이 review-req 17에이전트/394k 소비, 동일 결함을 단일 패스로 ~10k에 포착). 이를 막는 게이트.

**`lightweight=true` 조건** (아래 **모두** 충족 시):
- 순수 로직/표시 변경 (외부 의존성 추가 없음)
- API 계약·DB 스키마 변경 없음
- UI/통합 표면 없음 (브라우저 동작 불필요)
- 보안 민감 경로 아님 (인증/권한/입력신뢰경계 무관)
- 자동 테스트로 검증 가능 (수동 검증 불필요)
- 변경 표면 작음 (대략 work unit ≤ 3, 단일 모듈)

하나라도 불충족 → `lightweight=false`(기본, 보수적). **확신 없으면 false**(게이트 = 누락 위험 회피).

**게이트 보수화 (counter-metric 소비)**: rework-log에 `[프로세스] 게이트 과잉스킵: {게이트명}` 항목이 **×2 이상**이면 해당 게이트 기본 판정을 한 단계 보수화한다 — lightweight면 판정을 false로 강제(사유 보고), chunk verify면 강도 1→2, plan-judge/review-plan 스킵이면 실행으로 전환. 사용자에게 근거(rework-log 항목)와 함께 보고. (complete 4-B-2 게이트 감사가 기록하는 항목의 소비처 — 절감 게이트가 스스로 완화되기만 하고 감시받지 않는 것을 막는 개선 그래프 에지.)

**효과** (review-req/review-plan/verify args에 `lightweight: true` 주입 시):
- 관점 1개로 축소 + completeness critic 생략 + refuter 1명 → fan-out 비용 대폭 절감(17→~3 에이전트).
- 게이트 편향(결함유지)은 유지: refuter 1명이라도 불확실 시 결함 보존.
- S규모는 사실상 항상 lightweight 후보. M규모 중 위 조건 충족분도 포함(예: 순수 util 추가).

> 판정 결과를 **review-req/review-plan/verify 호출 args에 `lightweight` 필드로 주입**한다(scale·strength와 함께). 미주입 시 false(풀 검증).

#### 4-A: 검증 강도

검증 강도는 verify와 test 단계의 **에이전트팀 검수 수준**을 결정합니다:

| 검증 강도 | 검수 수준 | 적합한 경우 |
|----------|-------------|-----------|
| **표준** (1) | 에이전트팀 검증자 1명 | 일반적인 기능 추가/수정 |
| **강화** (2+) | 에이전트팀 관점별 복수 검증자 | 복잡한 변경, 높은 품질 요구 |

**규모별 기본 추천**:
- S → 표준(1) 추천
- M → 강화(2) 추천 (v5.2.3 재배분 — 코드 검증 렌즈 2개)
- L → 강화(2) 추천

**AskUserQuestion 호출**:
```
question: "검증 강도를 선택하세요."
header: "검증 강도"
options:
  - label: "{추천 강도} (Recommended)"
    description: "{추천 근거}"
  - label: "{나머지 옵션}"
    description: "{설명}"
multiSelect: false
```

> 추천 옵션을 최상단에 `(Recommended)` 표시로 배치하고, **나머지 옵션만** 아래에 나열합니다 (추천과 중복 금지).

**S규모 강도 2+ 경고**: S규모에서 강화(2+)를 선택하면 경고를 표시합니다:
```
⚠️ S규모 작업에 강화 검증은 비용 대비 효과가 낮습니다.
   검증자 수만 복수가 되며, 수렴 라운드는 1회로 고정됩니다.
   계속하시겠습니까?
```
재확인 후에도 **수렴 라운드는 1회 고정** (4-B에서 질문하지 않음). S규모는 강도 무관 **검증자 최대 1명**입니다.

#### 4-B: 수렴 라운드 상한

검증 강도 2+ **이고** M/L 규모일 때만 질문합니다. 강도 1 또는 S규모에서는 **수렴 1회 고정** (질문 생략).

수렴 라운드는 verify/test PASS 후 **새 팀으로 교체하여 재검증**하는 횟수입니다. 연속 0건이면 조기 확정됩니다.

**규모별 기본 추천**:
- M → 1회 추천 (현행 유지, 보수적)
- L → 2회 추천

> 수렴 상한이 높을수록 이슈 조기 발견 가능성이 높아지지만 토큰 비용도 증가합니다. 대부분의 M 규모 작업은 1회로 충분하며, L 규모 또는 높은 품질 보증이 필요한 경우 2~3회를 권장합니다. **5회 초과는 비용 비효율적이므로 권장하지 않습니다.**

**AskUserQuestion 호출**:
```
question: "수렴 검증 상한을 설정하세요. (verify와 test 각각 적용)"
header: "수렴 검증 상한"
options:
  - label: "{기본값}회 (Recommended)"
    description: "{규모} 규모 기본값 — 대부분의 작업에 적합"
  - label: "1회"
    description: "최소 수렴 — 경량 검수, 빠른 진행"
  - label: "2회"
    description: "2라운드 반복 — 복잡한 변경 또는 중요 기능"
  - label: "3회"
    description: "3라운드 반복 — 높은 품질 보증 요구"
  - label: "4회 / 5회"
    description: "최대 신뢰도 — 비용 높음"
multiSelect: false
```

> 추천과 중복되는 선택지는 제외합니다.

#### 4-C: 테스트 방식

test 단계의 실행 방식을 설정합니다.

**기존 자동 스킵 조건 확인**: S규모 + UI/UX AC 없음 + CLAUDE.md에 `## 테스트 환경` 없음 → 이 질문을 생략하고 자동 스킵합니다.

자동 스킵에 해당하지 않으면 **AskUserQuestion 호출**:
```
question: "테스트 방식을 선택하세요."
header: "테스트 방식"
options:
  - label: "자동 (Recommended)"
    description: "에이전트팀이 브라우저/API 테스트를 자동 실행합니다"
  - label: "수동"
    description: "사용자가 직접 테스트하고 결과를 입력합니다"
  - label: "혼합"
    description: "자동화 가능 항목은 에이전트팀, 나머지는 사용자가 직접 테스트"
  - label: "스킵"
    description: "테스트를 생략하고 verify만으로 완료합니다"
multiSelect: false
```

**UI AC 가드**: design 문서에 UI/UX 관련 AC가 존재하면 "스킵" 선택지를 비활성화합니다. 사용자가 면제 사유를 명시적으로 입력한 경우에만 예외 허용 → 상태 파일에 `test_skip_reason` 기록.

> 기존 자동 스킵 해당인데 사용자가 테스트를 원하면 → 경고: "스킵 조건에 해당합니다. 테스트를 실행하시겠습니까?" → 재확인 후 진행.

**스킵/수동 선택 시 design 문서 기록**:
- "스킵" 선택 → design 문서의 `## 검증 설정` 섹션에 `테스트 스킵 사유` 항목 추가:
  ```markdown
  테스트 스킵 사유: {자동 스킵 조건 충족 / 사용자 명시 면제 사유} ({날짜})
  ```
- "수동" 또는 "혼합" 선택 → `## 검증 설정`에 `테스트 방식: 수동` 또는 `테스트 방식: 혼합` 기록 (test 단계에서 `awaiting_manual_result` phase 사용)

#### 4-D: TDD on/off 토글

work units 단위검증에 TDD(RED-GREEN-REFACTOR) 적용 여부를 결정합니다.

**규모별 기본 추천**:
- S/M → off 추천 (경량 진행)
- L → off 추천. 사용자가 품질 보증 목적으로 명시 on 가능

**AskUserQuestion 호출**:
```
question: "구현 단계에서 TDD(RED-GREEN-REFACTOR)를 강제할까요?"
header: "TDD 토글"
options:
  - label: "off (Recommended)"
    description: "기본 — 단위테스트만 수행 (테스트 작성 순서 자유)"
  - label: "on"
    description: "로직성 unit에 RED→GREEN→REFACTOR 강제. 인프라 unit은 자동으로 스킵"
multiSelect: false
```

- on 선택 시 → 3-B에서 도출된 work units의 검증방식 자동 제안이 갱신됨: 로직성 unit 기본값 `단위테스트-TDD`, 인프라 unit `스킵(인프라 변경 — TDD 부적합)`. 사용자에게 갱신된 표 일괄 재승인 요청.
- off 선택 시 → 기존 검증방식(`단위테스트`/`수동`/`스킵`) 유지.

> TDD on은 verify 단계의 RED 게이트(verify SKILL.md)와 연동됩니다. `단위테스트-TDD` unit은 RED 단계 기록 부재 시 verify 진입이 차단됩니다.

#### 4단계 결과 기록

design 문서의 `## 검증 설정` 섹션에 기록:
```markdown
## 검증 설정
- 검증 강도: 강화 (2) — 에이전트팀 관점별 복수 검증자
- 수렴 라운드: 2회 — 연속 0건 시 조기 확정
- 테스트 방식: 혼합 — 에이전트팀 자동화 + 사용자 수동 확인
- TDD: on — 로직 unit RED-GREEN-REFACTOR 강제 (또는 off — 단위테스트만)
```

> 검증 설정은 verify와 test에 적용됩니다. review-req는 규모 기반 자동 결정 (plan 이전 실행이므로).
> 수렴 상한은 verify와 test 각각에 독립 적용됩니다.

### 5단계: 병렬 가능성 판단 — wave 분해 결과 참조

**병렬 가능성을 여기서 재분석하지 않는다.** 3-B 5단계 wave 분해가 이미 `writes` 비충돌 + 무의존으로 결정론 계산했다. 그 결과를 읽어 판정:

- **wave 최대 너비 ≥ 2** (어떤 wave에 동시 실행 unit 2개 이상) → **병렬 가능**.
- **wave 최대 너비 = 1** (모든 wave가 단일 unit = 순수 순차 의존 체인) → **병렬 불가**(단일 세션).
- **S 규모** (work unit·wave 미생성) → 병렬 불가(단일 세션).

> 직관 대조용(판정 근거 아님): "독립 모듈/FE+BE/MSA 서비스별 변경"은 보통 writes 비충돌 → 다른 unit이 같은 wave에 묶임. "순차 의존/단일 파일 체인/공유 인터페이스 변경 후 구현체"는 의존 또는 writes 충돌 → 다른 wave로 분리. wave가 이를 자동 반영한다.

### 6단계: 기능 브랜치 분기

`.forge-flow/config.json`의 `branch_strategy` 필드를 참조합니다.

- 사용자가 특정 브랜치를 지정한 경우 → 해당 브랜치에서 작업
- 지정 없으면 → `branch_strategy.base_branch`에서 기능 브랜치 분기
  - 브랜치명: `branch_strategy.feature_pattern` 적용 (예: `feature/{작업명}`)

```bash
# 기능 브랜치 생성
git checkout -b feature/{작업명}
```

### 7단계: 다음 단계 결정

확정 규모 + 병렬 가능성에 따라 분기:

```
S → 구현으로 직행 (review-plan 스킵)
M (review-plan 조건 미해당) → 구현으로 직행
M (review-plan 조건 해당) → review-plan 실행
L → review-plan 실행 (필수)
```

**M 규모에서 review-plan 실행 조건** (하나라도 해당 시):
- 새 외부 의존성 도입
- API 계약 변경 (요청/응답 스키마)
- DB 스키마 변경
- 3개 이상 모듈에 영향
- 기존 프로젝트에 없던 패턴 도입

**판정 결과를 사용자에게 보고** (자동 판정, 질문 아님):
```
[review-plan 실행 판정]
  ✅ 새 외부 의존성: spring-kafka 추가
  ❌ API 계약 변경: 없음
  ❌ DB 스키마 변경: 없음
  ✅ 3개 이상 모듈 영향: user, product, payment
  ❌ 프로젝트 새 패턴: 없음

  → 2개 조건 해당 → review-plan을 실행합니다.
```

### 에이전트팀 동적 구성

### 에이전트팀 vs 단일 세션 결정 (필수 확인)

아래 의사결정 트리를 **순서대로** 확인하여 방식을 결정합니다:

```
1. S 규모 → 단일 세션 구현 (work unit·wave 미생성)
2. wave 최대 너비 1 (어떤 wave도 동시 unit 2개 미만) → 단일 세션 구현 (병렬 이득 없음)
3. 그 외 (wave 최대 너비 2+) → 에이전트팀 구성
```

#### 병렬 구현 승인 (wave 소비 — 독립성 재판정 금지)

병렬 단위 = 3-B wave 분해 결과 그대로 (여기서 재분석 금지). 승인 보고는 간결하게:

```
[병렬 구현 계획]
규모: {M/L}, wave: {W}계층, 최대 병렬도: {N}
  wave 진행: W0 [{unit}] → W1 [{unit}] → … (wave 간 barrier)
공유 인터페이스 (선행 writes ∩ 후속 reads): {파일·시그니처}
```

**AskUserQuestion 호출**: "위 wave 구성으로 병렬 구현할까요?" — "승인 — 병렬 구현 (Recommended)" / "단일 세션 구현" / "구성 수정".

> 구 역할 정의(리더/구현자/리뷰어)·리더의 in-memory 단위검증 추적·agent_team 상태 스키마는 **v5.2.3에서 폐지** — implement 워크플로의 구조적 게이트(wave 분해·dependsOn 차단 전파·reconciliation)가 대체한다.

#### 구현 실행 — implement Workflow (wave 병렬 + reconciliation)

사용자 승인 후, 메인은 **`implement` 워크플로**를 호출하여 wave별 병렬 구현을 위임한다(기존 TeamCreate+Agent 수작업 대체). wave별 구현자가 **격리 worktree**에서 동시 구현하고, wave 끝마다 reconciliation 담당자가 통합 브랜치에 병합한다.

> **격리 worktree 근거(정밀)**: source writes는 wave 분해(3-B)로 비충돌 보장이나 — 같은 wave unit들이 `검증방식`(빌드/테스트)을 **동시 실행 시 공유 빌드 상태**(`target/`·`node_modules/`·`.pyc`)를 경쟁한다. worktree 격리는 *파일 편집*이 아니라 **동시 빌드 격리**를 위한 것. (git 레벨 병합 메커니즘은 검증 완료 — disjoint writes → 순차 병합 clean.)

**호출 절차**:
1. `Workflow` 도구를 `scriptPath`로 호출 — robust glob 1순위:
   `marketplaces/*/forge-flow/workflows/implement.js` (count=1; 다중 매치 시 `$CLAUDE_PLUGIN_ROOT/workflows/implement.js` 폴백).
2. `args` 주입 (객체; 워크플로가 JSON 문자열로 받아 방어 파싱):
   - `taskId`, `scale`
   - `repoRoot`: **대상 저장소 절대 경로** (`.forge-flow/config.json` 또는 현재 repo 루트 — 누락 시 워크플로 fail-fast)
   - `integrationBranch`: plan 6단계서 분기한 기능 브랜치명
   - `workUnits`: design `### work units` 표를 파싱한 배열 — 각 `{ id, title, ac, writes:[파일], reads:[파일], verifyMethod(=검증방식), verifyCriteria(=검증 기준), dependsOn:[id](=의존), wave }`
   - `designExcerpt`: `## 구현 계획`/AC 발췌, `patternsExcerpt`: 따를 기존 패턴, `projectContext`: 스택+빌드 명령 ≤3줄, `reworkLogExcerpt`: rework-log `[코드]` ×2+
3. **반환 처리**: `{ verdict, integrationBranch, integrationRef, done:[id], blocked:[id], units, reconciliation }`
   - `verdict==='COMPLETE'` (blocked 0) → phase `implementing` 유지하고 **즉시 `/forge-flow:verify` 호출**(integrationRef를 verify gitDiff 근거로).
   - `verdict==='PARTIAL'|'FAILED'` → `blocked` unit이 REWORK 대상. §7 에스컬레이션 규칙으로 라우팅(rework_lifetime 갱신은 메인). 통합 브랜치엔 성공 wave까지만 병합돼 있음.
4. **throw 처리**: status=failed 또는 반환에 `verdict` 부재 → 배선 오류(repoRoot/workUnits/integrationBranch 주입 점검·재호출). 2연속 throw = 보고·중단.

> **단위검증·의존 게이트 = 구조적**(P0). reader의 in-memory PASS/FAIL 추적 불요 — wave 분해가 독립성을, `dependsOn` 차단 전파가 의존 실패를, 각 구현자의 `검증방식` 실행이 단위검증을 담당. wave 간 reconciliation의 "전체 스위트 함께 실행"이 의미적 비양립(disjoint write라도)을 잡는 최종 게이트.
> **seam 계약**: 워크플로는 구현 결과 요약만 반환. 통합 브랜치 상태·verify 전이·rework 카운터는 메인.
> **task별 Spec compliance 리뷰**(위 `중간 검수 A`)는 L규모서 reconciliation 이후 메인이 별도 수행 가능(에이전트간 검수, 대화형 아님).
> **저하 모드**: `implement` 워크플로 미가용(2연속 throw) 시 메인이 단일 세션으로 wave 순서대로 직접 구현(단위검증 절차 본인 수행).

## design 문서 갱신

`## 규모 판정` 섹션의 확정 라인 기입:
```markdown
## 규모 판정
- 예비 (clarify): M — 인증 모듈 내 변경
- 확정 (plan): M — 변경 파일 7개 (src/auth/ 4개, test/auth/ 3개)
```

## 상태 파일 갱신 (완료 시)

```json
{
  "phase": "implementing",
  "scale": "M",
  "stop_count": 0
}
```

> **구현 직행 시** (S규모, M규모 review-plan 불필요): phase를 `"implementing"`으로 전이.
> **review-plan 필요 시** (L규모 필수, M규모 조건부): phase를 `"planning"` 유지. review-plan 스킬이 `"reviewing-plan"`으로 전이하고, PASS 시 `"implementing"`으로 전이.
> 구현 직행 시 phase를 `"implementing"`으로 전이.

## 완료 후 다음 단계

- **chunk 모드** → review-plan 판정(경계표 대상)이 필요하면 먼저 수행 후, **첫 chunk의 JIT 계획 작성 → 구현 → `/forge-flow:verify`(chunk verify)** 루프에 진입합니다. 이후 chunk 전환·통합 verify 라우팅은 verify SKILL `## chunk 모드`가 담당합니다.
- **S, M(조건 미해당)** → 사용자의 추가 입력 없이 설계대로 **즉시 구현을 시작**합니다.
- **M(조건 해당), L** → 사용자의 추가 입력 없이 **즉시 `/forge-flow:review-plan`을 호출**합니다.
- **에이전트팀 구성 시** (wave 최대 너비 2+) → 사용자 승인 후 메인이 **`implement` 워크플로 호출**(wave 병렬 구현자 + reconciliation). 완료 verdict로 verify 진행 또는 blocked REWORK 라우팅. (위 "구현 실행 — implement Workflow" 참조)

> **단일 세션 구현 시 단위검증 절차** (M/L 규모, design `### work units` 섹션이 있을 때 — wave 최대 너비 1 또는 implement 워크플로 저하 모드): 메인 세션이 직접 wave 순서대로 구현할 때, 다음 unit 착수 직전 직전 unit의 `검증방식`을 실행하고, FAIL이면 의존 후속 unit 진행을 차단합니다(독립 unit은 계속). 검증방식별: `단위테스트`→명령 실행 PASS 확인, `수동`→AC 기준 self-review, `스킵(사유)`→즉시 PASS. 상태는 본인 컨텍스트(in-memory)에서 추적합니다. (병렬 구현 시 이 절차는 implement 워크플로의 각 구현자가 수행하므로 메인 추적 불요.)
