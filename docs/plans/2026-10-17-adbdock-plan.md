# adbdock Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** macOS에서 여러 Android 기기에 ADB 명령을 쉽게 실행하고, 선택적으로 기기별 Metro 매핑을 저장·복구한다.

**Architecture:** CLI와 감시 프로세스가 같은 ADB 어댑터와 연결 관리 로직을 사용한다. CLI와 감시 프로세스의 설정 변경·복구는 같은 파일 잠금으로 직렬화한다. 로컬 소켓은 실행 확인과 중지에 사용한다. UI와 별도 MCP 서버는 만들지 않는다.

**Tech Stack:** Node.js 22+, TypeScript, node:test, Node 내장 parseArgs/child_process/net/fs/http, 외부 adb.

---

## 작업 위치와 진행 규칙

- 새 프로젝트 위치: `/Users/floydkim/projects/adbdock`.
- 새 Git 저장소의 feat/initial-cli 브랜치에서 구현한다.
- 아래 파일 경로는 새 프로젝트 루트를 기준으로 한다.
- 설계 문서는 `docs/plans/2026-10-17-adbdock-design.md`에 있다.
- 기능을 한 단계씩 구현하고 각 단계의 실제 결과를 보고한다. 첫 피드백 지점은 Task 2B 이후다.
- 사용자가 구현 시작 시 의미 단위 커밋을 승인했다. 각 커밋의 메시지를 먼저 알리고 커밋한다.
- 외부 패키지 추가는 필요가 확인된 경우만 한다. 메뉴바/플러그인 추상화는 추가하지 않는다.

## Task 1: CLI 진입점과 실행 계약

**Files:** package.json, tsconfig.json, src/cli.ts, src/output.ts, test/cli.test.ts, .gitignore.

1. 현재 설치된 Node/adb 버전과 adb help를 확인한다. RTK.md 참조 파일은 제공된 경로들에서 찾지 못했으므로 내용이 있는 척하지 않는다.
2. npm package bin을 adbdock → dist/cli.js로 지정하고 build/typecheck/test 스크립트를 만든다.
3. 실제 CLI를 subprocess로 실행하는 테스트를 작성한다. 시나리오는 도움말, 알 수 없는 명령, JSON 오류의 stdout 순수성이다.
4. npm test로 미구현 테스트 실패를 확인한다.
5. parseArgs와 JSON envelope를 구현한다. 프로세스 종료는 진입점에서만 결정한다.
6. npm run build, npm run typecheck, npm test를 실행한다. 도움말 종료 0, 잘못된 인자 종료 2를 확인한다.

## Task 2: 기기 조회와 단발 Metro 연결

**Files:** src/adb.ts, src/devices.ts, src/link.ts, src/cli.ts, test/fixtures/fake-adb.mjs, test/link.test.ts, README.md.

1. fake-adb는 argv와 실행 기록을 파일에 저장하며 설정한 devices/reverse 출력, 실패, 지연을 반환하도록 만든다. 환경변수로 테스트의 adb 경로만 주입한다.
2. 시나리오 테스트를 작성한다: 기기 네 개가 있어도 지정한 대상에만 실행, devicePort 8081에서 Metro 8082로 연결, 인증 필요 기기를 건너뜀, 대상이 모호하면 쓰기 없음, timeout 시 자식 프로세스 정리.
3. npm test로 실패를 확인한다.
4. shell 문자열 조합 대신 spawn/execFile 인자 배열로 adb를 실행한다. 모든 기기 명령에 -s를 명시한다.
5. devices -l과 reverse --list를 파싱하고 metro bind <serial> --port <port> 단발 동작을 구현한다. 포트는 정수 1..65535만 받는다.
6. 외부 reverse 충돌을 덮어쓰지 않는 시나리오와 명시적 --replace 시나리오를 추가한다.
7. build/typecheck/test 후 실제 adb devices와 reverse --list를 읽기 전용으로 확인한다. 실제 쓰기 대상이 명확히 확인된 경우에만 기기에 bind를 실행한다.
8. README에 실행 예시와 실제 기기 검증 여부를 기록하고 첫 사용 결과를 사용자에게 보여준다.

## Task 2B: Metro 없이 여러 기기에 일반 ADB 명령 실행

**Files:** src/adb.ts, src/devices.ts, src/cli.ts, src/output.ts, test/adb-command.test.ts, README.md.

1. fake-adb로 선택한 두 기기에만 명령 실행, --all의 대상 목록 고정, 인자 보존, 일부 실패에도 계속 실행, JSON 기기별 결과를 테스트한다. Metro 프로세스와 설정 파일이 없어도 동작해야 한다.
2. npm test로 실패를 확인한다.
3. `adbdock adb --device pixel --device galaxy -- shell pm list packages` 형태로 -- 이전 도구 옵션과 이후 ADB 인자를 분리한다. 모든 실행에 -s를 명시하고 Mac 셸 문자열을 만들지 않는다.
4. 첫 버전의 지원 범위는 유한한 기기 대상 명령이다. 호스트 대상 명령, 대상/서버 변경 옵션, 지속 스트림과 대화형 shell은 명확한 오류로 거부한다. 설치된 adb help를 기준으로 허용 명령을 문서화한다.
5. 결과에 deviceId, transportSerial, stdout, stderr, exitCode, timeout 여부를 보존한다. 제한된 동시성으로 실행하며 명령은 자동 재시도하지 않는다. 실패한 기기가 있으면 전체 종료 코드 1을 반환한다.
6. build/typecheck/test를 실행한다. 실제 연결된 기기에는 getprop 등 읽기 전용 명령으로 기기별 결과 구분을 확인한다.
7. Metro 기능과 독립적인 기본 사용 예시를 README에 먼저 배치한다.

## Task 3: 매핑 저장, 별칭과 안전한 변경

**Files:** src/store.ts, src/devices.ts, src/link.ts, src/cli.ts, test/store.test.ts, test/link.test.ts.

1. 기기/devicePort별 저장, 별칭 중복 거부, 재시작 후 매핑 보존, 잘못된 설정 파일에서 덮어쓰기 없이 실패하는 시나리오 테스트를 작성한다.
2. 임시 사용자 데이터 경로에서 테스트 실패를 확인한다.
3. schemaVersion이 있는 JSON 설정과 원자적 파일 교체를 구현한다. 단발 쓰기는 프로세스 간 잠금으로 직렬화한다. 잠금 구현은 임의의 stale PID 삭제에 의존하지 않도록 검증한다.
4. alias, 저장된 별칭 metro bind, metro unbind, metro repair --device/--all을 구현한다.
5. 현재 reverse가 마지막 관리 값과 다르면 unbind가 외부 규칙을 삭제하지 않는 테스트를 작성하고 통과시킨다.
6. 저장 변경과 ADB 적용 결과를 별도로 보고한다. 기기가 오프라인이어도 사용자의 원하는 설정은 보존한다.
7. build/typecheck/test를 실행한다.

## Task 4: 포그라운드 감시와 상태 조회

**Files:** src/watch.ts, src/status.ts, src/link.ts, src/cli.ts, test/watch.test.ts, test/status.test.ts.

1. online → offline → online 시나리오에서 reverse 복원, 이미 일치하면 쓰기 없음, 한 기기 실패 중 다른 기기 정상 복구, 설정 변경 반영을 테스트한다.
2. npm test로 실패를 확인한다.
3. 약 2초 조회, 겹치지 않는 감시 주기, 기기별 재시도 backoff, 제한된 동시성, SIGINT/SIGTERM 종료를 구현한다. 이미 실행 중인 adb 명령에도 timeout을 적용한다.
4. Mac localhost의 Metro /status를 제한 시간 내 조회한다. 연결 실패와 Metro 응답 불일치는 구분한다.
5. status에 transport/reverse/metro/app 상태를 분리한다. Metro 매핑이 없으면 not_configured로 표시하고 서버 조회를 하지 않는다. app 상태는 관측하지 않았으므로 unknown으로 둔다.
6. 상태 조회 자체는 성공하되 일부 기기가 오프라인인 JSON 시나리오를 검증한다.
7. build/typecheck/test를 실행한다.

## Task 5: 백그라운드 실행과 단일 소유권

**Files:** src/daemon.ts, src/watch.ts, src/store.ts, src/cli.ts, test/daemon.test.ts.

1. 감시 중복 시작 방지, startup handshake 실패, CLI 변경의 직렬 처리, 감시 프로세스 비정상 종료 후 재시작, 다른 프로세스에 대한 종료 방지 시나리오 테스트를 작성한다.
2. npm test로 실패를 확인한다.
3. Unix socket과 실행 식별자, 사용자만 접근하는 런타임 디렉터리, background spawn과 readiness handshake를 구현한다. 실행 파일/인자는 설치 후 CLI 경로를 사용한다.
4. CLI 변경과 감시 복구는 같은 설정 잠금으로 직렬화한다. daemon socket은 ping/stop만 처리한다. 시작/종료 경계의 경합을 테스트한다.
5. watch --background와 stop을 구현한다. stop 후 매핑과 reverse가 유지되는지 확인한다. 로그는 stdout 파이프가 아닌 크기가 제한된 파일에 기록한다.
6. build/typecheck/test를 실행한다.

## Task 6: 무선 재연결과 안정적인 기기 식별

**Files:** src/wireless.ts, src/devices.ts, src/watch.ts, test/wireless.test.ts, test/devices.test.ts.

1. 설치된 adb의 mdns services 출력과 연결된 기기의 식별 정보를 직접 확인하고 fixture로 남긴다. 지원되지 않는 정보에 기대어 자동 연결을 구현하지 않는다.
2. 같은 실기기의 USB/Wi-Fi 중복, endpoint 변경, 동일 모델 두 대, 복수 에뮬레이터, 식별 불가능 상태를 시나리오로 테스트한다.
3. 테스트 실패 후 확실한 식별 근거가 있는 경우만 묶는다. USB를 우선하며 연결 경로가 바뀌어도 매핑을 다시 확인한다.
4. 알려진 무선 기기의 현재 mDNS endpoint만 연결 대상으로 삼고 제한된 backoff로 재시도한다. 초기 페어링과 인증은 필요 상태로 표시한다.
5. 식별이 모호하면 자동 쓰기를 멈추고 구체적인 대상 선택 방법을 오류에 제공한다.
6. build/typecheck/test를 실행한다.

## Task 7: 패키징과 실제 동시 운영 검증

**Files:** README.md, docs/manual-validation.md, package.json.

1. npm pack --dry-run으로 배포 파일과 실행 권한을 확인한다. npm install로 전역 설치하지 않고 임시 prefix 설치로 CLI 실행을 검증한다.
2. USB 실기기 1대 + Wi-Fi 실기기 1대 + 에뮬레이터 2대의 실제 가용성을 확인한다. 미보유 기기와 미검증 시나리오는 명시한다.
3. 하나의 Metro를 공유한 경우와 8081/8082/8083으로 나눈 경우를 실행한다. 기기별 서로 다른 프로젝트의 화면 변경을 직접 확인한다.
4. USB 탈착, 무선 재연결/주소 변경, 잠자기 복귀, Metro 중지/재시작을 순서대로 검증한다. 각 시나리오에서 다른 기기의 연결을 방해하지 않는지 확인한다.
5. Metro 상태만 정상인 것을 앱 연결 성공으로 기록하지 않는다. 실제 Fast Refresh를 확인한 항목만 성공으로 기록한다.
6. 최종 build/typecheck/test와 변경 diff를 검토한다. 기존 adb 설정에 대한 변경과 복원 방법을 문서화한다.
7. 사용자에게 구현 결과, 자동 테스트, 실제 기기 검증 범위를 보고한다. 커밋 메시지 예시 `feat: add adbdock multi-device ADB CLI with optional Metro recovery`를 제안하고 승인 전에는 커밋하지 않는다.
