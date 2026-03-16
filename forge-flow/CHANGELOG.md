# forge-flow Changelog

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
- **fix**: hooks 등록 경로를 **상대 경로 → 절대 경로**로 변경
  - Claude가 세션 중 서브프로젝트로 CWD 이동 시 "No such file or directory" 오류 해결
  - `settings.local.json`: `bash {PROJECT_ROOT}/.claude/hooks/...` (절대 경로)
  - `settings.json` (에이전트팀): `bash "$(git rev-parse --show-toplevel)/.claude/hooks/..."` (동적 경로)
  - `--update` 시 기존 상대 경로를 절대 경로로 자동 마이그레이션
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
