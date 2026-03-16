# forge-flow 팀 설치 가이드

## 사전 요구사항

- Claude Code CLI v2.1 이상
- python3 (macOS/Linux 기본 포함)
- jq (권장, 미설치 시 python3으로 자동 폴백)

---

## 0. 기존 워크플로 제거 (해당 시만)

이전 버전(`/forge-flow:install`)으로 세팅된 프로젝트가 있다면, 먼저 제거 후 새로 설치합니다.

프로젝트 디렉토리에서 아래 항목을 수동 제거:

```bash
# 1. 훅 스크립트 제거
rm -f .claude/hooks/stop-guard.sh
rm -f .claude/hooks/workflow-state.sh
rm -f .claude/hooks/dangerous-cmd-guard.sh

# 2. 세션 상태 디렉토리 제거
rm -rf .forge-flow/

# 3. settings.local.json에서 hooks 항목 제거
#    .claude/settings.local.json을 열어 "hooks" 키 전체를 삭제합니다.
#    (다른 설정은 보존)

# 4. CLAUDE.md에서 forge-flow 섹션 제거
#    <!-- forge-flow:version=X.X.X --> 마커부터
#    forge-flow가 삽입한 섹션(작업 원칙, 워크플로, 빌드 명령, 브랜치 전략 등)을 삭제합니다.
#    프로젝트 고유 내용은 보존합니다.
```

> `design/` 디렉토리는 설계 문서가 있을 수 있으니 확인 후 판단하세요.

제거 완료 후 아래 1단계부터 진행합니다.

---

## 1. 플러그인 설치

```bash
# 압축 해제
unzip forge-flow-plugin.zip -d ~/forge-plugins

# 마켓플레이스 등록
claude plugin marketplace add ~/forge-plugins

# 플러그인 설치
claude plugin install forge-flow
```

설치 확인:
```bash
claude plugin list
```

`forge-flow`가 목록에 나오면 완료.

---

## 2. 프로젝트에 워크플로 적용

적용할 프로젝트 디렉토리에서 Claude Code를 열고:

```
/forge-flow:setup-workflow
```

자동으로 수행되는 항목:
- CLAUDE.md에 워크플로 섹션 삽입
- `.claude/hooks/`에 훅 스크립트 복사 (종료 차단, 상태 알림, 위험 명령 차단)
- `design/` 디렉토리 생성 (설계 문서용)
- `.forge-flow/` 디렉토리 생성 (세션 상태 파일용)
- `.gitignore`에 `.forge-flow/` 추가

기존 프로젝트는 빌드/테스트 명령, 브랜치 전략 등을 자동 감지합니다.

---

## 3. 워크플로 사용법

### 작업 시작

새 작업은 자연어로 요청하면 자동 시작됩니다:

```
"로그인 기능 추가해줘"
"결제 API 버그 수정"
```

또는 명시적으로:
```
/forge-flow:clarify
```

### 워크플로 순서

```
/forge-flow:clarify       요구사항 명확화
    ↓
/forge-flow:review-req    요구사항 교차검증 (자동)
    ↓
/forge-flow:plan          구현 계획 설계 (자동)
    ↓
/forge-flow:review-plan   설계 검수 (L 필수, M 조건부)
    ↓
구현
    ↓
/forge-flow:verify        종합 검수
    ↓
커밋
```

각 단계는 자동으로 다음 단계로 진행됩니다.

### 규모별 동작

| 규모 | 기준 | 검수 수준 |
|------|------|----------|
| S | 1-2 파일, 기존 패턴 | 빌드 + AC 체크 |
| M | 3-10 파일, 로직 수정 | 빌드 + 코드 리뷰 + 서브에이전트 검증 |
| L | 10+ 파일, 아키텍처 변경 | 전체 검수 + 설계 검수 필수 |

### 품질 게이트

모든 검수 단계에서 4단계 판정:

| 판정 | 후속 조치 |
|------|----------|
| PASS | 다음 단계 진행 |
| CONCERNS | 사용자 판단 |
| REWORK | 수정 후 재검수 (3회 연속 시 FAIL) |
| FAIL | 이전 단계로 돌아감 |

---

## 4. 팀 공유 항목

| 항목 | git 추적 | 공유 범위 |
|------|:--------:|----------|
| `design/` | O | 설계 문서 — 팀 공유 |
| `.forge-flow/` | X | 세션 상태 — 개인 |
| `.claude/hooks/` | X | 훅 스크립트 — 개인 |
| `CLAUDE.md` | O | 워크플로 설정 — 팀 공유 |

---

## 5. 관리 명령

```
/forge-flow:setup-workflow              # 신규 설치
/forge-flow:setup-workflow --update     # 플러그인 업데이트 반영
/forge-flow:setup-workflow --reset      # 전체 제거 후 재설치
/forge-flow:setup-workflow --purge      # 완전 제거
```

---

## 6. 훅 동작

설치 시 3개의 훅이 자동 등록됩니다:

| 훅 | 동작 |
|----|------|
| workflow-state | 매 프롬프트에 현재 워크플로 상태 알림 |
| stop-guard | 미완료 워크플로 종료 차단 (3회 연속 시도 시 강제 허용) |
| dangerous-cmd-guard | `rm -rf`, `DROP TABLE` 등 위험 명령 차단 |

---

## 7. 문제 해결

**Q. 세션이 종료되지 않아요**
→ `/forge-flow:verify` 통과 후 종료 가능합니다. 긴급 시 3회 연속 종료 시도하면 강제 허용됩니다.

**Q. 이전 작업이 감지되었다고 나와요**
→ 이전 세션의 `design/*.md` 파일이 남아있는 경우입니다. 이어서 진행하거나, 새 작업이면 `/forge-flow:clarify`로 시작하세요.

**Q. 플러그인 업데이트 후 프로젝트에 반영이 안 돼요**
→ `/forge-flow:setup-workflow --update`로 갱신하세요. 프로젝트 커스텀 설정(빌드 명령, 브랜치 전략)은 보존됩니다.
