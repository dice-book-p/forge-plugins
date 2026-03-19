# forge-flow Changelog

## v3.2.1

- **feat**: 훅 스크립트 절대경로 참조 — 프로젝트에 스크립트 복사 불필요
  - `installed_plugins.json`에서 플러그인 설치 경로 자동 탐지
  - `settings.local.json` / `settings.json` hooks를 절대 경로로 등록
  - 기존 `.claude/hooks/*.sh` 파일 자동 정리 (마이그레이션)
  - worktree(에이전트팀)에서 훅 파일 미발견 문제 해결
- **feat**: 에이전트팀 기본 활성화
  - setup-workflow 에이전트팀 선택 기본값 `[Y/n]`으로 변경
  - review-req: M/L 규모에서 에이전트팀 기본 사용
  - verify: 검증 강도 1+에서 에이전트팀 기본 사용
  - test: 테스트 팀 에이전트팀 기본 사용
  - plan: 에이전트팀 동적 구성 기본 활성화
  - 서브에이전트는 에이전트팀이 과한 경우(단일 작업자)만 폴백
- **change**: setup-workflow 단계 재구성 — 4.4~4.8 제거, 4.2 플러그인 경로 탐지 추가, 4.7 마이그레이션 추가
- **change**: --update 흐름 — 스크립트 복사 대신 경로 갱신 + 기존 파일 정리
- **change**: --purge/--reset 흐름 — 프로젝트 훅 파일 삭제 대신 settings hooks 블록 제거
- **affected**: setup-workflow SKILL.md + 훅 스크립트, review-req, verify, test, plan SKILL.md, 버전 마커

## v3.2.0

- **feat**: `/forge-flow:complete` 신규 스킬 — 작업 마무리 단계 추가
  - 커밋 여부 확인 (AskUserQuestion: 커밋 진행/메시지 수정/변경 확인/스킵)
  - design 문서 처리 선택 (삭제/요약 보존 via knowledge-hub/archive 보관)
  - 상태 파일 자동 정리
  - test PASS 후 자동 트리거
- **feat**: 검증 강도(0~N) 사용자 선택 — plan 단계에서 교차검증 수준 설정
  - 경량(0): 교차검증 스킵, 표준(1): 서브에이전트 1개, 강화(2+): 검증팀 구성
  - 규모별 기본 추천 (S=0, M=1, L=2) + 사용자 오버라이드
  - design 문서에 `검증 강도` 섹션 추가
  - verify, test 단계에서 검증 강도 참조
- **feat**: review-req S규모 교차검증 스킵 — S규모는 메인 세션 검수만 수행
- **feat**: 코드 패턴 강화
  - workflow-state.sh implementing 메시지에 '따를 기존 패턴' 참조 안내 추가
  - plan 구현자 프롬프트에 패턴 테이블 포함
  - verify 검증자 프롬프트에 패턴 테이블 명시적 포함
  - review-plan 패턴 일관성 검수 항목 구체화
- **feat**: stop-guard에 tested/completing 상태 통과 추가
- **change**: 워크플로 테이블 8단계 '커밋' → `/forge-flow:complete`로 변경
- **affected**: complete SKILL.md (신규), clarify, plan, verify, test, review-req, review-plan SKILL.md, setup-workflow SKILL.md + 훅 스크립트 + 템플릿, 버전 마커

## v3.1.15

- **feat**: plan/verify에 기존 코드 패턴 일관성 규칙 추가
  - plan 1단계: 기존 코드 패턴 파악 스텝 신설 (네이밍, 에러 처리, 파일 구조 등)
  - plan 3단계: 구현 계획에 `따를 기존 패턴` 테이블 추가 — 항목별 패턴 + 근거 파일 기록
  - verify: 코드 리뷰에서 `따를 기존 패턴` 기준 대조, 위반 시 REWORK 판정
  - 원칙: 별도 요청 없으면 기존 패턴 유지, 패턴 변경은 사용자 승인 필요
- **affected**: plan SKILL.md, verify SKILL.md, 버전 마커

## v3.1.14

- **feat**: clarify에 프로젝트 업데이트 알림 기능 추가
  - plugin.json에 `requires_update` 필드 신설 — 훅/CLAUDE.md 섹션 변경 시에만 갱신
  - clarify 실행 시 CLAUDE.md 버전 마커 < `requires_update`이면 `--update` 안내 표시 (차단 없이 정상 진행)
  - 스킬만 변경된 배포에서는 알림 없음 (자동 반영)
- **affected**: clarify SKILL.md, plugin.json, 버전 마커

## v3.1.13

- **change**: test 스킬 섹션 구조 재배치 — 에이전트팀을 기본, 서브에이전트를 폴백으로 전환
  - 테스트 팀(기본) → 단일 테스터(폴백) 순서로 변경
  - `## 테스트 환경 준비` 섹션 신설 — CLAUDE.md 브라우저 테스트 지침 확인 → 도구 선택 규칙 Read → 프롬프트 주입 흐름 명시
  - 프롬프트 플레이스홀더를 `{테스트 환경 준비 단계에서 수집한 도구 선택 규칙 + 환경 정보}`로 구체화
- **affected**: test SKILL.md, 버전 마커

## v3.1.12

- **feat**: workflow-state 훅에 `/compact` 안내 추가
  - 안전한 시점 (implementing 진입, verified): compact 권장 안내
  - 피해야 할 시점 (clarifying, reviewing-req, reviewing-plan, verifying): compact 주의 안내
  - planning: plan 완료 후 compact 권장 안내
- **affected**: setup-workflow SKILL.md (workflow-state.sh 훅 스크립트), 버전 마커

## v3.1.11

- **fix**: 에이전트팀/서브에이전트 spawn 지시 명확화 — 3개 스킬 일괄 수정
  - 에이전트팀 섹션: "에이전트팀 기능으로 구성 (Agent tool 서브에이전트가 아님)" 명시
  - 서브에이전트 폴백 섹션: "Agent tool로 서브에이전트 spawn" 명시 + "(폴백)" 라벨 추가
  - 에이전트팀 활성화 시 Agent tool 서브에이전트로 실행되던 문제 해결
- **feat**: 판정 상태 한글화 — 사용자 표시는 한글, 내부 관리는 영문 유지
  - 품질 게이트: 통과(PASS) / 주의(CONCERNS) / 재작업(REWORK) / 실패(FAIL)
  - AskUserQuestion header, 결과 보고, 에스컬레이션 안내: 한글
  - 에이전트 프롬프트 응답 형식, 상태 파일, design 기록: 영문 유지
  - CLAUDE.md 템플릿 워크플로 테이블: 한글 동기화
- **affected**: test, verify, review-req, review-plan SKILL.md, CLAUDE.md 템플릿, 버전 마커

## v3.1.10

- **feat**: test 스킬 에이전트팀 전환 — 복수 테스터를 에이전트팀 패턴으로 전환
  - 팀 활성화 조건: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` + 테스트 도메인 2개 이상
  - 비활성화 시 단일 테스터(기본) 폴백 유지
  - 테스트 팀 구성 보고 + 상태 파일 `agent_team` 확장
  - 실패한 테스터만 재실행 가능 (전체 재실행 불필요)
  - 모델: `sonnet` 고정 유지
- **feat**: review-req 스킬 에이전트팀 지원 추가 (L규모 조건부)
  - L규모 + 팀 활성화 시: 검증자-완전성/실현성/일관성 동적 구성
  - S/M 규모 또는 팀 비활성화 시: 기존 서브에이전트 교차검증 유지
  - 상태 파일 `agent_team` 확장
  - 모델: 세션 모델 상속 유지
- **affected**: test SKILL.md, review-req SKILL.md, plugin.json, marketplace.json, 버전 마커

## v3.1.9

- **feat**: `AskUserQuestion` 패턴 도입 — 사용자 피드백을 구조화된 선택지 UI로 수집
  - clarify: 요구사항 재진술 확인, 핵심 질문 (선택지 있는 경우), 스펙 확정 동의
  - review-req: PASS 후 사용자 확인 게이트 (승인/수정/재검토)
  - plan: 에이전트팀 구성 승인 (승인/단일세션/구성수정)
  - verify/test/review-req/review-plan: CONCERNS 판정 시 사용자 판단 위임
- **affected**: clarify, review-req, plan, review-plan, verify, test SKILL.md, 버전 마커

## v3.1.8

- **feat**: 검증자(Verifier)와 테스터(Tester) 역할 분리
  - `verify`: 코드 수준 검증에 집중 (AC 대조, 패턴 일관성, 사이드이펙트)
  - `test`: 실행 테스트 신규 스킬 — 브라우저 자동화(UI/UX) + API 테스트
  - 테스터는 `model: "sonnet"` 고정 (리더가 opus여도 테스터는 sonnet)
  - verify PASS 후 자동으로 test 호출 (S 규모 + UI AC 없으면 스킵)
- **change**: verify에서 "검증자-테스트" 역할 제거 → test 스킬로 이관
- **change**: 워크플로 테이블에 test 단계 추가 (verify → test → 커밋)
- **change**: 모델 사용 전략에 테스터 sonnet 고정 추가
- **affected**: verify SKILL.md, test SKILL.md (신규), CLAUDE.md 템플릿, plugin.json, 버전 마커

## v3.1.7

- **feat**: 사용자 확인 게이트 추가 — review-req PASS 후 사용자 승인을 받아야 plan 진행
  - 요구사항 확정까지 사용자가 반드시 피드백하여 의도와 다른 방향 방지
  - review-req 결과 요약 + "진행할까요?" 형식으로 보고
- **feat**: 에이전트팀 모델 사용 전략 도입
  - 분석/검증/플랜 (review-req 서브에이전트, verify 검증팀): 세션 모델 상속 (model 파라미터 생략)
  - 구현/리뷰 (plan 구현자, 리뷰어): `model: "sonnet"` 고정
  - opus 세션에서는 검증은 opus, 구현은 sonnet → 비용 절감 + 품질 유지
- **change**: CLAUDE.md 템플릿 워크플로 테이블에 사용자 확인 단계 추가
- **change**: CLAUDE.md 템플릿 에이전트팀 섹션에 모델 사용 전략 추가
- **affected**: review-req, plan, verify SKILL.md, CLAUDE.md 템플릿, 버전 마커

## v3.1.6

- **feat**: 에이전트팀 실질 통합 — "제안"에서 **동적 팀 구성 + spawn**으로 전환
  - plan: 작업 분석 기반 동적 팀 구성 (레이어/모듈/서비스/도메인 분리)
  - plan: 구현자 + 리뷰어 역할 정의, spawn 프롬프트 템플릿, 상태 파일 확장
  - verify: 관점별 검증 팀 동적 구성 (AC/패턴/시나리오별 검증자)
  - verify: 에이전트팀 비활성화 시 기존 서브에이전트 교차검증 유지 (폴백)
- **feat**: 훅 스크립트에 에이전트팀 팀원 감지 추가
  - workflow-state.sh: worktree + `.forge-flow/` 부재 시 팀원 컨텍스트 주입
  - stop-guard.sh: 팀원은 리더가 생명주기 관리하므로 즉시 통과
- **feat**: 에이전트팀 활성화 시 `.claude/settings.json`에 hooks 이중 등록
  - `settings.local.json`은 gitignore → worktree에 미포함 문제 해결
- **change**: CLAUDE.md 템플릿 에이전트팀 섹션 구체화 (동적 팀 구성 가이드라인)
- **fix**: hooks 경로 문제 해결 — 서브프로젝트 훅 스크립트 복사 방식으로 전환
  - Claude가 세션 중 서브프로젝트로 CWD 이동 시 "No such file or directory" 오류 해결
  - 상대 경로 유지 + 모노레포 서브프로젝트에 훅 스크립트 복사 (settings.local.json은 루트에만)
  - 절대 경로는 에이전트팀(worktree) 환경에서 원본 레포 참조 문제가 있어 사용하지 않음
  - `--update` 시 기존 절대 경로를 상대 경로로 정규화 + 서브프로젝트 훅 동기화
- **affected**: plan, verify, review-plan SKILL.md, setup-workflow SKILL.md + 훅 스크립트 + 템플릿, 버전 마커

## v3.1.5

- **feat**: state 파일 경로 `.forge-flow/state-*.json` → `.forge-flow/state/state-*.json`으로 분리
  - `.forge-flow/` 하위를 `design/`과 `state/` 두 디렉토리로 정리
- **fix**: `--update` 시 Claude가 CHANGELOG 기반으로 훅을 "지능적 수정"하던 문제 해결
  - CHANGELOG는 사용자 리포트 전용임을 명시
  - 훅 업데이트는 4.4 섹션 인라인 정본을 그대로 복사하도록 지시 강화
  - 기존 훅 내용 무시 + 전체 교체(덮어쓰기) 원칙 명시
- **change**: 서브프로젝트 훅 설치 제거 — 훅은 루트에만 설치 (세션 시작 시 CWD 기준 1회 로드)
- **affected**: 전 스킬 SKILL.md, setup-workflow SKILL.md + 훅 스크립트 + 템플릿, 버전 마커

## v3.1.4

- **feat**: `design/` → `.forge-flow/design/`로 통합 — 워크플로 관련 파일을 `.forge-flow/` 한 곳에서 관리
- **feat**: 작업 완료(커밋) 시 design 파일 + state 파일 자동 정리
- **feat**: completed 상태 파일은 다음 세션 진입 시 즉시 정리 (+ 연결된 design 파일 포함)
- **feat**: orphan design 파일 감지 시 알림만 → 자동 삭제로 변경
- **fix**: 훅 스크립트를 SKILL.md에 인라인 포함 — Claude가 경로를 못 찾아 구버전을 작성하는 문제 해결
- **affected**: clarify, review-req, verify SKILL.md, setup-workflow SKILL.md + 템플릿 + 훅 스크립트

## v3.1.3

- **feat**: 모노레포 서브프로젝트 자동 감지 + 훅 자동 설치
  - 빌드 파일(package.json, build.gradle 등) 기준으로 서브프로젝트 탐지
  - 루트 + 모든 서브프로젝트에 `.claude/hooks/*.sh` 복사
  - 각 서브프로젝트 `settings.local.json`에 hooks 블록 병합 (기존 설정 보존)
- **feat**: `--update` 시 신규 서브프로젝트 감지 + 자동 설치
- **feat**: `--purge` 시 모든 서브프로젝트 hooks 정리
- **design**: CLAUDE.md + design/ + .forge-flow/는 루트 집중 유지 (Claude가 부모 CLAUDE.md 자동 상속)
- **affected**: setup-workflow SKILL.md, CLAUDE.md 버전 마커

## v3.1.2

- **fix**: 훅 스크립트 `echo` → `printf '%s'` 변경 (특수문자 포함 명령 파싱 에러 수정)
  - dangerous-cmd-guard.sh: JSON 파싱 + grep 패턴 매칭
  - stop-guard.sh: stdin JSON 파싱
- **affected**: 훅 스크립트 2개, CLAUDE.md 버전 마커

## v3.1.1

- **fix**: orphan 감지 정확 매칭 (`grep "design/파일명"` → `grep "\"design/파일명\""`)
- **fix**: 상태 파일 7일 자동 정리 추가
- **fix**: dangerous-cmd 변형 패턴 보강 (`rm -r -f`, `rm -fr`, `TRUNCATE TABLE`)
- **fix**: circuit breaker `stop_hook_active` 의존 제거, `stop_count`만으로 동작
- **affected**: 훅 스크립트 3개, CLAUDE.md 버전 마커

## v3.1.0

- **feat**: rework_count 상태 파일 필드 추가 (3회 REWORK → FAIL 에스컬레이션 추적)
- **feat**: verify 선행 phase 검사 추가 (implementing 아니면 차단)
- **feat**: 자동 진행 "즉시 호출" 명시 (clarify→review-req→plan 체인)
- **feat**: L 규모 verify 동작 명시 (아키텍처 검토, 전파 체인 검증)
- **feat**: review-plan 자동 판정 체크리스트 보고 형식
- **feat**: FE 체크 트리거 조건 명확화 (CLAUDE.md `## FE 빌드 명령` 존재 여부)
- **feat**: build-check에 테스트 실행 통합
- **change**: stop_count 리셋 시점 통일 (전진 전이 시 리셋)
- **change**: REWORK 재시도 흐름 명확화 (phase 롤백 + 재호출)
- **change**: install → setup-workflow 스킬명 변경
- **affected**: 전 스킬 SKILL.md, 훅 스크립트, CLAUDE.md 템플릿

## v3.0.0

- 초기 릴리스
- clarify → review-req → plan → review-plan → verify 워크플로
- 3개 훅 (workflow-state, stop-guard, dangerous-cmd-guard)
- jq + python3 폴백 패턴
