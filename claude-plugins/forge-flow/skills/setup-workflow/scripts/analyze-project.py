#!/usr/bin/env python3
"""
프로젝트 분석 스크립트 — 파일 내용 기반 자동 추론

디렉토리 구조와 파일 내용을 분석하여 빌드 명령, Handoff 타입,
서비스 간 통신 패턴, 프로젝트 규모를 자동으로 추론합니다.

STACK_MAP 하드코딩 방식 대신, 실제 파일 내용을 파싱하여
어떤 신규 기술이 도입되더라도 자동으로 처리합니다.

사용법:
  # JSON 출력 (기본)
  python3 analyze-project.py --dirs . src/ frontend/

  # env 형식 출력 (SKILL.md에서 eval로 사용)
  python3 analyze-project.py --dirs . --roles backend frontend --output env

출력 JSON 구조:
  {
    "build_cmds":    ["Bash(./gradlew *)", "Bash(pnpm *)"],
    "handoff_types": ["api-spec", "db-schema", "code"],
    "comm_patterns": ["grpc", "rest-api", "event-based"],
    "scale":         "medium",
    "proto_modules": ["module_interface"],
    "submodules":    ["module_common", "module_interface"]
  }

comm_patterns 코드값 정의:
  grpc        — .proto 파일 존재
  rest-api    — Controller/Router 패턴 또는 Swagger/OpenAPI
  event-based — Kafka/RabbitMQ Consumer/Publisher 패턴
  graphql     — .graphql / .gql 스키마 파일 존재

scale 값: solo | small | medium | large
  - solo:   역할 1개 이하
  - small:  역할 2개, 단일 레포
  - medium: 역할 3개+ 또는 멀티 레포
  - large:  역할 4개+ 또는 멀티 레포 3개+
"""
import json, os, glob, sys, argparse, re


# ─── 빌드 아티팩트 제외 glob ────────────────────────────────────────────────────

SKIP_DIRS = frozenset({
    'build', 'node_modules', '.gradle', 'dist', 'out', '__pycache__',
    '.git', 'target', '.next', '.nuxt', '.output', '.svelte-kit', 'vendor',
})


def _glob_src_only(d, pattern):
    """빌드 아티팩트·의존성 디렉토리를 제외하고 소스 파일만 검색합니다."""
    all_matches = glob.glob(os.path.join(d, pattern), recursive=True)
    result = []
    for m in all_matches:
        rel = os.path.relpath(m, d)
        parts = rel.split(os.sep)
        if not any(p in SKIP_DIRS for p in parts):
            result.append(m)
    return result


# ─── 빌드 명령 추출 ────────────────────────────────────────────────────────────

def _first_word(cmd_str):
    """명령어 문자열에서 첫 번째 실행 가능 토큰 추출"""
    s = (cmd_str or "").strip()
    if not s:
        return None
    # 환경변수 대입 건너뜀 (KEY=value cmd → cmd)
    tokens = s.split()
    for t in tokens:
        if "=" not in t:
            return t
    return tokens[0]


def _to_allow(cmd):
    """실행 토큰 → allow 패턴. 상대 경로 스크립트는 그대로 유지"""
    if not cmd:
        return None
    if cmd.startswith("./") or cmd.startswith("../"):
        return f"Bash({cmd} *)"
    return f"Bash({cmd} *)"


_EXCLUDE_BUILD_CMDS = frozenset({
    # placeholder 스크립트
    "echo", "printf", "true", "false", ":", "exit",
    # 위험 시스템 명령 (Bash(rm *) 같은 광범위 권한 추가 방지)
    "rm", "find", "cp", "mv", "mkdir", "chmod", "chown", "ln", "touch",
    "cat", "grep", "sed", "awk", "xargs", "kill", "pkill",
    # Node.js 런타임 + git hooks 관리자 (빌드 명령 아님)
    "node", "nodemon", "ts-node", "tsx", "bun", "husky", "lint-staged",
    # 테스트 러너 (빌드 단계 아님 — pytest/jest는 실제 빌드 파이프라인에서 분리)
    "jest", "mocha", "jasmine", "vitest", "ava", "tape", "tap",
    # 린터 (빌드 단계 아님)
    "eslint", "prettier", "stylelint", "tslint",
    # Python 범용 실행자 (너무 광범위 — 구체적 도구로 대체)
    "python", "python3",
})


def _is_excluded_build_cmd(tok):
    """빌드 명령이 아닌 런타임·테스트·린터 명령 필터링"""
    return tok in _EXCLUDE_BUILD_CMDS


def analyze_build_cmds(dirs):
    """
    각 디렉토리를 탐색하여 사용 중인 빌드 명령을 동적으로 추출합니다.

    파싱 대상:
    - package.json scripts 섹션 (Node.js 계열 전체)
    - gradlew (Gradle, Android 포함)
    - pom.xml / mvnw (Maven)
    - go.mod (Go)
    - Cargo.toml (Rust)
    - Makefile (C/C++, 범용)
    - CMakeLists.txt (CMake)
    - pyproject.toml / setup.py / requirements.txt (Python)
    - pubspec.yaml (Flutter/Dart)
    - Podfile / *.xcodeproj (iOS/macOS)
    - composer.json (PHP/Laravel)
    - Gemfile (Ruby/Rails)
    - *.csproj / global.json (.NET/C#)
    - scripts/*.sh, bin/*.sh (커스텀 쉘 스크립트)
    - Dockerfile / docker-compose.yml
    """
    all_cmds = set()

    for d in dirs:
        d = d.rstrip("/")
        if not os.path.exists(d):
            continue

        # ── Node.js 계열: package.json scripts 직접 파싱 ──────────────────────
        pkg_path = os.path.join(d, "package.json")
        if os.path.exists(pkg_path):
            try:
                pkg = json.load(open(pkg_path, encoding="utf-8"))
                for val in pkg.get("scripts", {}).values():
                    tok = _first_word(val)
                    if tok and not _is_excluded_build_cmd(tok):
                        all_cmds.add(f"Bash({tok} *)")
                # 패키지 매니저 감지
                if os.path.exists(os.path.join(d, "pnpm-lock.yaml")):
                    all_cmds.add("Bash(pnpm *)")
                elif os.path.exists(os.path.join(d, "yarn.lock")):
                    all_cmds.add("Bash(yarn *)")
                else:
                    all_cmds.add("Bash(npm *)")
                # Turborepo 모노레포
                if os.path.exists(os.path.join(d, "turbo.json")):
                    all_cmds.add("Bash(turbo *)")
                    all_cmds.add("Bash(pnpm *)")
            except Exception:
                pass

        # ── Gradle (Java/Kotlin/Android) ──────────────────────────────────────
        if os.path.exists(os.path.join(d, "gradlew")):
            all_cmds.add("Bash(./gradlew *)")
        elif any(os.path.exists(os.path.join(d, f))
                 for f in ("build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts")):
            all_cmds.add("Bash(./gradlew *)")

        # ── Maven ─────────────────────────────────────────────────────────────
        if os.path.exists(os.path.join(d, "pom.xml")):
            if os.path.exists(os.path.join(d, "mvnw")):
                all_cmds.add("Bash(./mvnw *)")
            else:
                all_cmds.add("Bash(mvn *)")

        # ── Go ────────────────────────────────────────────────────────────────
        if os.path.exists(os.path.join(d, "go.mod")):
            all_cmds.add("Bash(go *)")

        # ── Rust ──────────────────────────────────────────────────────────────
        if os.path.exists(os.path.join(d, "Cargo.toml")):
            all_cmds.add("Bash(cargo *)")

        # ── Make / CMake ──────────────────────────────────────────────────────
        if os.path.exists(os.path.join(d, "Makefile")):
            all_cmds.add("Bash(make *)")
        if os.path.exists(os.path.join(d, "CMakeLists.txt")):
            all_cmds.add("Bash(cmake *)")
            all_cmds.add("Bash(make *)")

        # ── Python ────────────────────────────────────────────────────────────
        has_python = any(os.path.exists(os.path.join(d, f))
                         for f in ("pyproject.toml", "setup.py", "requirements.txt", "Pipfile"))
        if has_python:
            all_cmds.add("Bash(pip *)")
            pyproject = os.path.join(d, "pyproject.toml")
            if os.path.exists(pyproject):
                try:
                    content = open(pyproject, encoding="utf-8").read()
                    if "poetry" in content:
                        all_cmds.add("Bash(poetry *)")
                    if "pytest" in content or "hatch" in content:
                        all_cmds.add("Bash(pytest *)")
                    if "uv" in content:
                        all_cmds.add("Bash(uv *)")
                except Exception:
                    pass
            if os.path.exists(os.path.join(d, "Pipfile")):
                all_cmds.add("Bash(pipenv *)")

        # ── Flutter / Dart ────────────────────────────────────────────────────
        if os.path.exists(os.path.join(d, "pubspec.yaml")):
            all_cmds.add("Bash(flutter *)")
            all_cmds.add("Bash(dart *)")

        # ── iOS / macOS (Xcode) ───────────────────────────────────────────────
        has_xcode = (os.path.exists(os.path.join(d, "Podfile"))
                     or bool(glob.glob(os.path.join(d, "*.xcodeproj")))
                     or bool(glob.glob(os.path.join(d, "*.xcworkspace"))))
        if has_xcode:
            all_cmds.add("Bash(xcodebuild *)")
            all_cmds.add("Bash(pod *)")
        # Swift Package Manager
        if os.path.exists(os.path.join(d, "Package.swift")):
            all_cmds.add("Bash(swift *)")

        # ── PHP / Laravel ─────────────────────────────────────────────────────
        if os.path.exists(os.path.join(d, "composer.json")):
            all_cmds.add("Bash(composer *)")
            if os.path.exists(os.path.join(d, "artisan")):
                all_cmds.add("Bash(php *)")

        # ── Ruby / Rails ──────────────────────────────────────────────────────
        if os.path.exists(os.path.join(d, "Gemfile")):
            all_cmds.add("Bash(bundle *)")
            if os.path.exists(os.path.join(d, "Rakefile")):
                all_cmds.add("Bash(rake *)")

        # ── .NET / C# ─────────────────────────────────────────────────────────
        has_dotnet = (bool(glob.glob(os.path.join(d, "*.csproj")))
                      or bool(glob.glob(os.path.join(d, "*.sln")))
                      or os.path.exists(os.path.join(d, "global.json")))
        if has_dotnet:
            all_cmds.add("Bash(dotnet *)")

        # ── 커스텀 쉘 스크립트 (scripts/, bin/) ───────────────────────────────
        for scripts_subdir in ("scripts", "bin", "tools"):
            sdir = os.path.join(d, scripts_subdir)
            if os.path.isdir(sdir):
                for sh in glob.glob(os.path.join(sdir, "*.sh")):
                    rel = os.path.relpath(sh, d)
                    all_cmds.add(f"Bash(./{rel} *)")

        # ── Docker ────────────────────────────────────────────────────────────
        if (os.path.exists(os.path.join(d, "Dockerfile"))
                or os.path.exists(os.path.join(d, "docker-compose.yml"))
                or os.path.exists(os.path.join(d, "compose.yml"))):
            all_cmds.add("Bash(docker *)")
            all_cmds.add("Bash(docker-compose *)")

    return sorted(all_cmds)


# ─── Handoff 타입 추론 ─────────────────────────────────────────────────────────

def analyze_handoff_types(dirs):
    """
    프로젝트 파일 분석으로 적절한 Handoff 타입을 결정합니다.

    타입 결정 기준:
    - proto-changes : .proto 파일 존재 (gRPC)
    - api-spec      : Controller/router 패턴, swagger/openapi 파일,
                      또는 FE+BE가 같은 레포에 있는 경우 (모노레포 풀스택)
    - event-schema  : Consumer/Publisher/Listener 패턴, Kafka/RabbitMQ 설정
    - db-schema     : migration 파일, .sql, flyway/liquibase 설정
    - infra-spec    : k8s/, helm/, terraform/, ansible/ 디렉토리
    - code          : 항상 포함
    """
    types = {"code"}

    has_fe = False
    has_be = False

    for d in dirs:
        d = d.rstrip("/")
        if not os.path.exists(d):
            continue

        # ── gRPC (.proto) ────────────────────────────────────────────────────
        if _glob_src_only(d, "**/*.proto"):
            types.add("proto-changes")

        # ── REST API ─────────────────────────────────────────────────────────
        swagger = (_glob_src_only(d, "**/swagger*")
                   or _glob_src_only(d, "**/openapi*")
                   or _glob_src_only(d, "**/api-docs*"))
        if swagger:
            types.add("api-spec")

        # Controller 패턴 (Java/Spring, NestJS, Express 등)
        if (_glob_src_only(d, "**/*Controller*")
                or _glob_src_only(d, "**/*controller*")
                or _glob_src_only(d, "**/routes/**")
                or _glob_src_only(d, "**/router*")):
            has_be = True

        # ── 이벤트 기반 (Kafka, RabbitMQ 등) ─────────────────────────────────
        event_patterns = [
            "**/kafka*", "**/*Consumer*", "**/*consumer*",
            "**/*Publisher*", "**/*publisher*",
            "**/*Listener*", "**/*listener*",
            "**/rabbitmq*", "**/*EventHandler*",
        ]
        if any(_glob_src_only(d, p) for p in event_patterns):
            types.add("event-schema")

        # ── DB 스키마 (migration, SQL) ────────────────────────────────────────
        db_patterns = [
            "**/migrations/**", "**/migration/**",
            "**/*.sql", "**/flyway*", "**/liquibase*",
            "**/db/schema*", "**/schema.rb",
            "**/V[0-9]*__*.sql",  # Flyway 명명 규칙
        ]
        if any(_glob_src_only(d, p) for p in db_patterns):
            types.add("db-schema")

        # ── 인프라 (K8s, Terraform 등) ───────────────────────────────────────
        infra_dirs = ["k8s", "kubernetes", "helm", "terraform", "ansible",
                      "manifests", "deploy", "infrastructure"]
        if any(os.path.isdir(os.path.join(d, x)) for x in infra_dirs):
            types.add("infra-spec")
        # 인프라 파일 패턴
        infra_files = ["**/*.tf", "**/*.tfvars", "**/Chart.yaml",
                       "**/*.yaml"]  # k8s yaml은 너무 광범위하므로 디렉토리 기반 우선
        if (glob.glob(os.path.join(d, "**/*.tf"), recursive=True)
                or glob.glob(os.path.join(d, "**/Chart.yaml"), recursive=True)):
            types.add("infra-spec")

        # ── FE 감지 ──────────────────────────────────────────────────────────
        # Next.js, React, Vue, Angular 등
        fe_indicators = ["src/app", "src/pages", "src/components",
                         "pages", "app", "components", "views",
                         "src/views", "src/router"]
        pkg_path = os.path.join(d, "package.json")
        if os.path.exists(pkg_path):
            try:
                pkg = json.load(open(pkg_path, encoding="utf-8"))
                deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
                fe_libs = {"react", "vue", "next", "nuxt", "angular", "@angular/core",
                           "svelte", "solid-js", "remix", "astro", "vite"}
                if fe_libs & set(deps.keys()):
                    has_fe = True
            except Exception:
                pass
        if any(os.path.isdir(os.path.join(d, x)) for x in fe_indicators):
            has_fe = True

    # ── 모노레포 풀스택 감지 (FE + BE 같은 레포) ─────────────────────────────
    # 멀티 dirs가 아니라 단일/동일 계층에 FE+BE가 공존하는 경우 api-spec 필요
    if has_fe and has_be:
        types.add("api-spec")

    # 순서 고정 (중요도 순)
    order = ["proto-changes", "api-spec", "event-schema", "db-schema", "infra-spec", "code"]
    return [t for t in order if t in types]


# ─── 기술 스택 감지 ─────────────────────────────────────────────────────────────

def _read_gradle_deps(d):
    """build.gradle / build.gradle.kts / pom.xml + 서브모듈 파일 내용 합산 반환"""
    content = ""
    for fname in ("build.gradle", "build.gradle.kts", "pom.xml"):
        fp = os.path.join(d, fname)
        if os.path.exists(fp):
            try:
                content += open(fp, encoding="utf-8", errors="ignore").read()
            except Exception:
                pass
    # 서브모듈 레벨 1 탐색
    try:
        for sub in os.listdir(d):
            sub_path = os.path.join(d, sub)
            if not os.path.isdir(sub_path):
                continue
            for fname in ("build.gradle", "build.gradle.kts", "pom.xml"):
                fp = os.path.join(sub_path, fname)
                if os.path.exists(fp):
                    try:
                        content += open(fp, encoding="utf-8", errors="ignore").read()
                    except Exception:
                        pass
    except Exception:
        pass
    return content


def analyze_tech_stack(dirs, roles=None):
    """
    각 디렉토리에서 기술 스택(언어/프레임워크/DB/통신)을 감지합니다.

    반환: {role_name: "스택 문자열"} 형식
    예: {"backend": "Java/Spring Boot, gRPC, Kafka, MySQL",
         "frontend": "TypeScript/Next.js, React, Tailwind CSS"}
    """
    result = {}
    dir_list = [d.rstrip("/") for d in dirs]

    for i, d in enumerate(dir_list):
        # roles 항목이 "name:dir:desc" 형식이면 첫 번째 부분(이름)만 추출
        raw_role = roles[i] if roles and i < len(roles) else os.path.basename(d) or d
        role_name = raw_role.split(":")[0] if ":" in raw_role else raw_role
        if not os.path.exists(d):
            result[role_name] = ""
            continue

        stack_parts = []

        # ── Java / Kotlin (Gradle) ────────────────────────────────────────────
        gradle_content = _read_gradle_deps(d)
        has_gradle = (bool(gradle_content)
                      or os.path.exists(os.path.join(d, "gradlew"))
                      or any(os.path.exists(os.path.join(d, f)) for f in
                             ("build.gradle", "build.gradle.kts",
                              "settings.gradle", "settings.gradle.kts", "pom.xml")))
        if has_gradle:
            lang = "Kotlin" if "kotlin" in gradle_content.lower() else "Java"
            fw = []
            extra = []
            if "org.springframework.boot" in gradle_content or "spring-boot" in gradle_content:
                fw.append("Spring Boot")
            if "io.grpc" in gradle_content or "com.google.protobuf" in gradle_content:
                extra.append("gRPC")
            if "spring-kafka" in gradle_content or "kafka-clients" in gradle_content:
                extra.append("Kafka")
            if "redisson" in gradle_content or "spring-data-redis" in gradle_content:
                extra.append("Redis")
            if "querydsl" in gradle_content.lower():
                extra.append("QueryDSL")
            if "spring-boot-starter-batch" in gradle_content or "spring-batch" in gradle_content:
                extra.append("Spring Batch")
            if "mybatis" in gradle_content.lower():
                extra.append("MyBatis")
            if "egovframework" in gradle_content.lower():
                extra.append("eGovFrame")
            if "mysql" in gradle_content.lower():
                extra.append("MySQL")
            if "postgresql" in gradle_content.lower() or "postgres" in gradle_content.lower():
                extra.append("PostgreSQL")
            if "mongodb" in gradle_content.lower():
                extra.append("MongoDB")
            stack = lang + ("/" + "/".join(fw) if fw else "")
            if extra:
                stack += ", " + ", ".join(extra)
            stack_parts.append(stack)

        # ── Python ────────────────────────────────────────────────────────────
        has_python = any(os.path.exists(os.path.join(d, f))
                         for f in ("requirements.txt", "pyproject.toml", "setup.py", "Pipfile"))
        if has_python:
            py_content = ""
            for pf in ("requirements.txt", "pyproject.toml", "setup.py"):
                fp = os.path.join(d, pf)
                if os.path.exists(fp):
                    try:
                        py_content += open(fp, encoding="utf-8", errors="ignore").read().lower()
                    except Exception:
                        pass
            fw = []
            extra = []
            if "fastapi" in py_content:
                fw.append("FastAPI")
            elif "django" in py_content:
                fw.append("Django")
            elif "flask" in py_content:
                fw.append("Flask")
            elif "starlette" in py_content:
                fw.append("Starlette")
            if "sqlalchemy" in py_content:
                extra.append("SQLAlchemy")
            if "psycopg2" in py_content or "asyncpg" in py_content:
                extra.append("PostgreSQL")
            if "pymysql" in py_content or "aiomysql" in py_content:
                extra.append("MySQL")
            if "grpc" in py_content:
                extra.append("gRPC")
            if "kafka" in py_content:
                extra.append("Kafka")
            if "redis" in py_content:
                extra.append("Redis")
            stack = "Python" + ("/" + "/".join(fw) if fw else "")
            if extra:
                stack += ", " + ", ".join(extra)
            stack_parts.append(stack)

        # ── Node.js / TypeScript ──────────────────────────────────────────────
        pkg_path = os.path.join(d, "package.json")
        if os.path.exists(pkg_path):
            try:
                pkg = json.load(open(pkg_path, encoding="utf-8"))
                deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
                fw = []
                extra = []
                lang = "TypeScript" if "typescript" in deps else "JavaScript"
                if "next" in deps:
                    fw.append("Next.js")
                if "react" in deps and "next" not in deps:
                    fw.append("React")
                if "@nestjs/core" in deps:
                    fw.append("NestJS")
                if "express" in deps:
                    fw.append("Express")
                if "fastify" in deps:
                    fw.append("Fastify")
                if "vue" in deps:
                    fw.append("Vue")
                if "@angular/core" in deps:
                    fw.append("Angular")
                if "svelte" in deps:
                    fw.append("Svelte")
                if "turbo" in deps or os.path.exists(os.path.join(d, "turbo.json")):
                    extra.append("Turborepo")
                if "tailwindcss" in deps:
                    extra.append("Tailwind CSS")
                # DB/서버 의존성: 프론트엔드 프레임워크가 감지된 경우 제외
                # (Turborepo 루트 package.json의 서버용 의존성 오감지 방지)
                _is_frontend = bool(fw) or "turbo" in deps or os.path.exists(
                    os.path.join(d, "turbo.json")
                )
                if not _is_frontend:
                    if "prisma" in deps or "@prisma/client" in deps:
                        extra.append("Prisma")
                    if "mongoose" in deps:
                        extra.append("MongoDB/Mongoose")
                    if "pg" in deps or "postgres" in deps:
                        extra.append("PostgreSQL")
                    if "mysql2" in deps or "mysql" in deps:
                        extra.append("MySQL")
                    if "ioredis" in deps or "redis" in deps:
                        extra.append("Redis")
                stack = lang + ("/" + "/".join(fw) if fw else "")
                if extra:
                    stack += ", " + ", ".join(extra)
                stack_parts.append(stack)
            except Exception:
                pass

        # ── Go ────────────────────────────────────────────────────────────────
        if os.path.exists(os.path.join(d, "go.mod")):
            try:
                go_content = open(os.path.join(d, "go.mod"), encoding="utf-8").read()
                fw = []
                extra = []
                if "gin-gonic/gin" in go_content:
                    fw.append("Gin")
                if "labstack/echo" in go_content:
                    fw.append("Echo")
                if "gofiber/fiber" in go_content:
                    fw.append("Fiber")
                if "google.golang.org/grpc" in go_content:
                    extra.append("gRPC")
                if "kafka" in go_content.lower():
                    extra.append("Kafka")
                stack = "Go" + ("/" + "/".join(fw) if fw else "")
                if extra:
                    stack += ", " + ", ".join(extra)
                stack_parts.append(stack)
            except Exception:
                stack_parts.append("Go")

        # ── Ruby / Rails ──────────────────────────────────────────────────────
        if os.path.exists(os.path.join(d, "Gemfile")):
            try:
                gem_content = open(os.path.join(d, "Gemfile"), encoding="utf-8", errors="ignore").read()
                fw = []
                extra = []
                if "rails" in gem_content.lower():
                    fw.append("Rails")
                elif "sinatra" in gem_content.lower():
                    fw.append("Sinatra")
                if "pg" in gem_content or "postgresql" in gem_content.lower():
                    extra.append("PostgreSQL")
                if "mysql2" in gem_content:
                    extra.append("MySQL")
                if "redis" in gem_content.lower():
                    extra.append("Redis")
                stack = "Ruby" + ("/" + "/".join(fw) if fw else "")
                if extra:
                    stack += ", " + ", ".join(extra)
                stack_parts.append(stack)
            except Exception:
                stack_parts.append("Ruby")

        # ── Flutter / Dart ────────────────────────────────────────────────────
        if os.path.exists(os.path.join(d, "pubspec.yaml")):
            try:
                pub_content = open(os.path.join(d, "pubspec.yaml"), encoding="utf-8", errors="ignore").read()
                extra = []
                if "http" in pub_content or "dio" in pub_content:
                    extra.append("HTTP")
                if "firebase" in pub_content.lower():
                    extra.append("Firebase")
                if "get_it" in pub_content or "riverpod" in pub_content or "bloc" in pub_content:
                    extra.append("State Mgmt")
                stack = "Flutter/Dart"
                if extra:
                    stack += ", " + ", ".join(extra)
                stack_parts.append(stack)
            except Exception:
                stack_parts.append("Flutter/Dart")

        # ── PHP / Laravel ─────────────────────────────────────────────────────
        if os.path.exists(os.path.join(d, "composer.json")):
            try:
                comp_content = json.load(open(os.path.join(d, "composer.json"), encoding="utf-8"))
                req = {**comp_content.get("require", {}), **comp_content.get("require-dev", {})}
                fw = []
                if any("laravel/framework" in k for k in req):
                    fw.append("Laravel")
                elif any("symfony/framework" in k for k in req):
                    fw.append("Symfony")
                stack = "PHP" + ("/" + "/".join(fw) if fw else "")
                stack_parts.append(stack)
            except Exception:
                stack_parts.append("PHP")

        # ── Rust ──────────────────────────────────────────────────────────────
        if os.path.exists(os.path.join(d, "Cargo.toml")):
            stack_parts.append("Rust")

        result[role_name] = " | ".join(stack_parts) if stack_parts else ""

    return result


# ─── 서비스 간 통신 패턴 감지 ──────────────────────────────────────────────────

def analyze_comm_patterns(dirs):
    """
    서비스 간 통신 패턴 자동 감지 (코드값 반환)

    반환 코드값:
      grpc        — .proto 파일 존재 또는 build.gradle grpc 의존성
      rest-api    — Controller/Router 패턴 또는 Swagger/OpenAPI 또는 express/fastapi 감지
      event-based — Kafka/RabbitMQ Consumer/Publisher 패턴 또는 build.gradle kafka 의존성
      graphql     — .graphql / .gql 스키마 파일 존재 (Java 파일명 제외)
    """
    patterns = []

    for d in dirs:
        d = d.rstrip("/")
        if not os.path.exists(d):
            continue

        # gRPC — .proto 파일 또는 build.gradle grpc 의존성
        if _glob_src_only(d, "**/*.proto"):
            if "grpc" not in patterns:
                patterns.append("grpc")
        else:
            gradle_content = _read_gradle_deps(d)
            if gradle_content and ("io.grpc" in gradle_content or "com.google.protobuf" in gradle_content):
                if "grpc" not in patterns:
                    patterns.append("grpc")

        # 이벤트 기반 — 파일 패턴 + build.gradle kafka 의존성 + requirements.txt
        event_file_patterns = [
            "**/*Consumer*", "**/*consumer*",
            "**/*Publisher*", "**/*publisher*",
            "**/*Listener*", "**/*listener*",
            "**/kafka*", "**/rabbitmq*", "**/*EventHandler*",
        ]
        event_detected = any(_glob_src_only(d, p) for p in event_file_patterns)
        if not event_detected:
            gradle_content = _read_gradle_deps(d)
            if gradle_content and ("spring-kafka" in gradle_content or "kafka-clients" in gradle_content):
                event_detected = True
        if not event_detected:
            req = os.path.join(d, "requirements.txt")
            if os.path.exists(req):
                try:
                    if "kafka" in open(req, encoding="utf-8").read().lower():
                        event_detected = True
                except Exception:
                    pass
        if event_detected and "event-based" not in patterns:
            patterns.append("event-based")

        # REST API — Controller 패턴 + express/fastapi/django 감지
        rest_file_patterns = [
            "**/*Controller*", "**/*controller*",
            "**/swagger*", "**/openapi*",
            "**/routes/**", "**/router*",
        ]
        rest_detected = any(_glob_src_only(d, p) for p in rest_file_patterns)
        if not rest_detected:
            pkg_path = os.path.join(d, "package.json")
            if os.path.exists(pkg_path):
                try:
                    pkg = json.load(open(pkg_path, encoding="utf-8"))
                    deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
                    if any(k in deps for k in ("express", "fastify", "@nestjs/core", "koa", "hapi")):
                        rest_detected = True
                except Exception:
                    pass
        if not rest_detected:
            req = os.path.join(d, "requirements.txt")
            pyproject = os.path.join(d, "pyproject.toml")
            for pf in (req, pyproject):
                if os.path.exists(pf):
                    try:
                        content = open(pf, encoding="utf-8").read().lower()
                        if any(fw in content for fw in ("fastapi", "django", "flask", "starlette")):
                            rest_detected = True
                    except Exception:
                        pass
        if rest_detected and "rest-api" not in patterns:
            patterns.append("rest-api")

        # GraphQL — 스키마 파일(.graphql, .gql)만 감지 (Java 클래스명 제외)
        if _glob_src_only(d, "**/*.graphql") or _glob_src_only(d, "**/*.gql"):
            if "graphql" not in patterns:
                patterns.append("graphql")

    return patterns


# ─── 프로젝트 규모 판단 ─────────────────────────────────────────────────────────

def analyze_scale(dirs, roles):
    """
    프로젝트 규모를 판단하여 질문 수 축소에 활용합니다.

    solo:   역할 1개 이하 (개인 프로젝트)
    small:  역할 2개, 단일 레포 (소규모 팀)
    medium: 역할 3개+, 단일/멀티 레포 (중간 규모)
    large:  역할 4개+, 멀티 레포 3개+ (대규모)
    """
    git_repos = sum(
        1 for d in dirs
        if os.path.exists(os.path.join(d.rstrip("/"), ".git"))
    )

    n_roles = len(roles)

    if n_roles <= 1:
        return "solo"
    elif n_roles == 2 and git_repos <= 1:
        return "small"
    elif n_roles >= 4 or git_repos >= 3:
        return "large"
    else:
        return "medium"


# ─── Proto 모듈 감지 ───────────────────────────────────────────────────────────

# proto 경로에서 모듈명으로 인식하면 안 되는 일반 경로 컴포넌트
_NON_MODULE_PATH_PARTS = frozenset({
    "src", "main", "java", "kotlin", "resources", "proto",
    "test", "gen", "generated", "grpc", "protobuf",
})


def analyze_proto_modules(dirs):
    """
    .proto 파일이 위치한 최상위 하위 디렉토리(모듈명)를 감지합니다.

    감지 방법:
    1. .proto 파일 위치 기반: parts[0]이 src/main 등 비모듈 경로면 디렉토리명 자체 사용
    2. build.gradle protobuf 플러그인 선언 기반

    예:
      module-proto/src/main/proto/user.proto → "module-proto"  (d == module-proto)
      backend/module_interface/user.proto    → "module_interface"
    반환: 모듈명 목록 (예: ["module_interface"])
    """
    found = []
    for d in dirs:
        d = d.rstrip("/")
        if not os.path.exists(d):
            continue

        # 방법 1: .proto 파일 직접 검색
        protos = _glob_src_only(d, "**/*.proto")
        for proto in protos:
            rel = os.path.relpath(proto, d)
            parts = rel.split(os.sep)
            if len(parts) >= 1:
                top = parts[0]
                # parts[0]이 src/main 등 비모듈 경로면 현재 디렉토리명을 모듈명으로 사용
                module_name = os.path.basename(d) if top in _NON_MODULE_PATH_PARTS else top
                if module_name and module_name not in found:
                    found.append(module_name)

        # 방법 2: .proto 파일이 있는 서브모듈 감지 (루트 디렉토리 스캔 시)
        # ⚠️ build.gradle protobuf 플러그인만으로는 감지하지 않음 — 소비자 서비스 오감지 방지
        if not protos:
            try:
                for sub in os.listdir(d):
                    sub_path = os.path.join(d, sub)
                    if not os.path.isdir(sub_path) or sub in SKIP_DIRS:
                        continue
                    # 실제 .proto 파일이 있는 서브모듈만 등록
                    sub_protos = _glob_src_only(sub_path, "**/*.proto")
                    if sub_protos and sub not in found:
                        found.append(sub)
            except Exception:
                pass

    return sorted(found)


# ─── 서브모듈 감지 ─────────────────────────────────────────────────────────────

def analyze_submodules(dirs):
    """
    settings.gradle / settings.gradle.kts의 include 선언으로 서브모듈 목록을 감지합니다.

    예: include ':module_common', ':module_interface' → ["module_common", "module_interface"]
    """
    found = []
    for d in dirs:
        d = d.rstrip("/")
        for fname in ("settings.gradle", "settings.gradle.kts"):
            sf = os.path.join(d, fname)
            if not os.path.exists(sf):
                continue
            try:
                content = open(sf, encoding="utf-8").read()
                # include ':module_common', ':module_interface' 형식
                matches = re.findall(r"""include\s+['"]:?([\w_\-]+)['"]""", content)
                for m in matches:
                    if m not in found:
                        found.append(m)
            except Exception:
                pass
    return found


# ─── 메인 ──────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(
        description="프로젝트 파일 분석으로 빌드 명령·Handoff 타입·통신 패턴을 자동 추론"
    )
    p.add_argument("--dirs", nargs="+", default=["."],
                   help="분석할 디렉토리 목록 (역할별 루트 디렉토리)")
    p.add_argument("--roles", nargs="+", default=[],
                   help="역할 이름 목록 (규모 판단에 사용)")
    p.add_argument("--output", choices=["json", "env"], default="json",
                   help="출력 형식: json (기본) 또는 env (eval용)")
    args = p.parse_args()

    result = {
        "_source_cwd":   os.getcwd(),
        "build_cmds":    analyze_build_cmds(args.dirs),
        "handoff_types": analyze_handoff_types(args.dirs),
        "comm_patterns": analyze_comm_patterns(args.dirs),
        "scale":         analyze_scale(args.dirs, args.roles),
        "proto_modules": analyze_proto_modules(args.dirs),
        "submodules":    analyze_submodules(args.dirs),
        "tech_stack":    analyze_tech_stack(args.dirs, args.roles),
    }

    if args.output == "json":
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        # env 형식 — SKILL.md에서 eval 또는 라인별 파싱에 사용
        print(f"BUILD_CMDS={json.dumps(result['build_cmds'])}")
        print(f"HANDOFF_TYPES={' '.join(result['handoff_types'])}")
        print(f"COMM_PATTERNS={json.dumps(result['comm_patterns'])}")
        print(f"SCALE={result['scale']}")
        print(f"PROTO_MODULES={json.dumps(result['proto_modules'])}")
        print(f"SUBMODULES={json.dumps(result['submodules'])}")
        print(f"TECH_STACK={json.dumps(result['tech_stack'])}")


if __name__ == "__main__":
    main()
