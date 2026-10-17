# 사용 가이드

[English](usage.md) | **한국어**

기본 설치와 빠른 시작은 [README](../README.ko.md)를 참고하세요.
이 가이드의 `phone`, `emulator`는 `adbdock alias`로 저장한 기기 별칭입니다.
기기 별칭은 명령을 보낼 대상을, `@menu` 같은 단축 명령어는 실행할 명령을 가리킵니다.

## 기기 선택과 별칭

`adbdock alias`에서 기기를 선택해 별칭을 설정하거나 변경합니다.
기억된 오프라인 기기도 이름을 바꿀 수 있습니다. 스크립트에서는 대화형 입력 대신
`adbdock alias <기기> <별칭>`처럼 둘 다 지정합니다.

ADB 명령과 단축 명령어는 같은 대상 선택 옵션을 사용합니다.

- `-d phone`: 기기 하나 선택. 여러 기기는 `-d phone -d emulator`처럼 반복합니다.
- `--all`: 온라인 기기 전체 선택. `-d`와 함께 사용할 수 없습니다.
- 대상 생략: 사용 가능한 온라인 기기가 한 대일 때 자동 선택합니다.

같은 실기기의 USB·Wi-Fi 연결은 하나로 묶고 USB를 우선 사용합니다.
특정 연결을 사용하려면 현재 ADB serial을 직접 지정합니다.
오프라인·미인증 기기는 자동 선택에서 제외되며, 직접 지정하면 오류를 반환합니다.

adbdock 옵션과 ADB 인자는 `--`로 구분합니다. 기본 제한 시간은 기기마다 10초이며,
오래 걸리는 작업은 `--` 앞에 `--timeout 120000`을 지정해 늘릴 수 있습니다.
대화형 셸과 스트리밍 명령은 지원하지 않습니다. `pull`, `bugreport`는 기기 하나만 지정할 수 있습니다.

## 무선 페어링

Android 11 이상에서 폰과 Mac을 같은 Wi-Fi에 연결하고 실행합니다.

```sh
adbdock pair --qr --alias phone
```

폰에서 **개발자 옵션 → 무선 디버깅 → QR 코드로 기기 페어링**을 열고 터미널의
QR을 스캔합니다. 기본 대기 시간은 60초이며, `--timeout 120000`으로 늘리거나
Ctrl+C로 취소할 수 있습니다.

코드를 입력하려면 **페어링 코드로 기기 페어링**을 열고 실행합니다.

```sh
adbdock pair --alias phone
```

검색된 기기가 여럿이면 대상을 선택하고 6자리 코드를 입력합니다. 입력한 코드는
화면에 표시되지 않습니다. 페어링 후 무선 연결을 확인하고 별칭과 이후 복구에 필요한
서비스 정보를 저장합니다. Metro 설정이나 watcher 실행은 하지 않으며, 지속적인
복구에는 `adbdock watch start --background`를 사용합니다.

자동 검색이 안 되면 페어링 화면의 주소를 직접 지정합니다. `--connect`에는
페어링 포트와 다른, 무선 디버깅 기본 화면의 **연결용 주소**를 지정합니다.

```sh
adbdock pair 192.168.0.7:37000 --connect 192.168.0.7:45000 --alias phone
```

코딩 에이전트는 페어링 대상을 JSON으로 조회한 뒤, 두 번째 명령의 표준입력으로
6자리 코드 한 줄을 전달할 수 있습니다.

```sh
adbdock pair --list --json
adbdock pair <ip:pairing-port> --alias phone --code-stdin --json
```

코드를 명령 인자로 받지 않으며, adbdock의 결과·설정·로그에도 기록하지 않습니다.
페어링과 연결은 별도 단계이므로 명령이 실패해도 `paired: true`일 수 있습니다.
재시도 전에 `connected`와 오류를 확인합니다. 연결이나 별칭 저장 실패가 이미 완료된
페어링을 취소하지는 않습니다. `adb connect <ip:connection-port>`로 연결을 마친 뒤
`adbdock alias`로 별칭을 저장할 수도 있습니다. 최초 페어링에는 폰의 페어링 코드 화면 또는 QR 스캐너가 필요합니다.

## 저장한 ADB 명령 실행

기본 단축 명령어는 Metro 설정 없이 바로 사용할 수 있습니다.

```sh
adbdock @menu -d phone
adbdock @screenshot -d phone -d emulator
adbdock @reverse -d phone
adbdock @reverse -d phone -- 8082 18081
```

`menu`는 React Native 개발자 메뉴를 엽니다(keyevent 82). `screenshot`은 현재
디렉터리에 기기마다 고유한 이름으로 PNG를 저장하고 경로를 출력합니다.
`reverse`에 인자를 생략하면 각 기기에 저장된 Metro 매핑을 적용하고, 설정이 없으면
기기 8081 → 호스트 8081을 사용합니다. 인자를 지정한 예시는 기기 18081 → 호스트
8082로 한 번만 연결합니다. 저장된 매핑은 바뀌지 않으며, watcher는 충돌하는 규칙을
덮어쓰지 않고 보고합니다.

등록 전에 터미널이 변수를 해석하지 않도록 **작은따옴표**로 명령을 감싸 주세요.

```sh
adbdock adb-alias add model 'adb shell getprop ro.product.model > "$ADBDOCK_DEVICE-$ADBDOCK_RUN_ID.txt" && open .'
adbdock @model --all
adbdock adb-alias list
adbdock adb-alias edit model
adbdock adb-alias remove model
```

`adbdock adb-alias`로 목록에서 골라 편집·삭제할 수도 있습니다. 같은 이름을 등록하면
덮어쓰기 전에 확인하며, 자동화에서는 `--force`를 사용할 수 있습니다. 기본 단축 명령어도
수정·삭제할 수 있고, 변경은 설정 디렉터리에 저장됩니다.

스크립트는 선택한 기기마다 `/bin/sh`에서 한 번씩 실행되며, 일반 `adb` 호출에 해당
기기가 자동 지정됩니다. `--` 뒤의 인자는 `$1`, `$2` 등으로 전달됩니다.

| 변수 | 값 |
|---|---|
| `$ADBDOCK_DEVICE` | 파일명에 쓸 수 있게 정리한 기기 별칭 또는 serial |
| `$ADBDOCK_MODEL` | 파일명에 쓸 수 있게 정리한 모델명 |
| `$ADBDOCK_SERIAL` | 원본 연결 serial |
| `$ADBDOCK_RUN_ID` | 기기별 실행마다 고유한 시각/UUID |
| `$ADBDOCK_REVERSE_PORTS` | 저장된 `기기포트:호스트포트` 목록, 없으면 `8081:8081` |

로컬 명령과 파일 저장도 실행되므로 신뢰하는 스크립트를 등록하고, 여러 기기에서
실행할 때는 고유한 파일 경로를 사용하세요. 작업 디렉터리는 공유됩니다.
기본 제한 시간은 10초이며 `--timeout`으로 바꿀 수 있습니다. Ctrl+C는 실행 중인
명령 그룹을 종료합니다. 실패한 명령은 재시도하지 않고, watcher도 명령 alias를 실행하지 않습니다.

## React Native와 Metro

각 프로젝트의 Metro 서버는 사용자가 직접 실행해야 합니다. adbdock의 터널을
이용하려면 앱의 개발 서버 주소가 `localhost:<기기 포트>`여야 합니다.
여기서 `localhost`는 Mac이 아니라 Android 기기 자신입니다. ADB reverse가
이 접속을 Mac의 Metro로 전달합니다. 에뮬레이터에도 동일하게 적용됩니다.

- `--port`: **Mac에서 Metro가 실행 중인 포트**
- `--device-port`: **앱이 접속하는 기기 쪽 포트**, 기본값 **8081**

adbdock은 앱의 서버 주소를 변경하지 않습니다. 앱이 다른 주소를 사용 중이면
사용자가 앱 설정을 변경해야 합니다. 

Mac의 LAN IP나 에뮬레이터의
호스트 주소 `10.0.2.2`로 직접 접속하면 ADB reverse를 거치지 않으므로
adbdock의 터널 복구가 해당 연결에 적용되지 않습니다.

### Metro 하나를 공유하기

```sh
adbdock metro bind phone --port 8081
adbdock metro bind emulator --port 8081
```

### 서로 다른 프로젝트 사용하기

에뮬레이터는 Metro 8081을 유지하고, 실기기만 다른 프로젝트의 Metro 8082로 옮깁니다.

```sh
adbdock metro bind phone --port 8082
```

| 기기 별칭 | Android 앱이 접속하는 주소 | Mac의 Metro 포트 |
|---|---|---|
| emulator | `localhost:8081` | 8081 포트의 Metro A |
| phone | `localhost:8081` | 8082 포트의 Metro B |

### 기기 쪽 포트 변경하기

앱이 `localhost:18081`에 접속하고 Mac의 Metro가 8082에서 실행 중이라면:

```sh
adbdock metro bind phone --port 8082 --device-port 18081
```

이 경우 `기기의 localhost:18081 → Mac의 Metro 8082`로 연결됩니다.
앱의 서버 주소는 별도로 맞춰야 합니다. `bind`는 매핑을 저장하고 즉시 적용을 시도하며,
자동 복구하려면 watcher도 실행해야 합니다. 기억된 기기가 오프라인이어도 매핑은 저장됩니다.

다른 도구가 만든 reverse 규칙의 목적지가 다르면 보존하고 충돌로 표시합니다.
의도적으로 덮어쓸 때만 `--replace`를 사용합니다. 목적지가 같은 외부 규칙은 그대로
사용하며, 나중에 `unbind`해도 제거하지 않습니다.

### 감시와 복구

```sh
adbdock watch start --background
```

백그라운드에서는 터미널을 닫아도 계속 실행됩니다. Mac을 재시작하면 다시 실행해야 합니다.
상태를 확인하려면:

```sh
adbdock watch status
adbdock status --json
```

watcher 없이 저장된 매핑을 한 번만 복구하려면:

```sh
adbdock metro repair --device phone
```

watcher는 약 2초마다 저장한 매핑을 확인하고 누락된 터널을 복구합니다.
실패 시 재시도 간격은 최대 30초까지 늘어납니다. 포그라운드에서 실행하려면
`adbdock watch` 또는 `adbdock watch start`를 사용하고 Ctrl+C로 중지합니다. `watch status`는 watcher만,
`status`는 기기·Metro 상태까지 확인합니다. 설정 디렉터리마다 watcher 하나가 실행됩니다.

감시를 중지하거나 매핑을 제거하려면 다음 명령을 사용합니다.

```sh
adbdock watch stop
adbdock metro unbind phone --device-port 8081
```

`watch stop`은 저장한 매핑과 현재 터널을 유지합니다. 위 `unbind`는 별칭이 `phone`인
기기의 8081 포트 매핑을 삭제합니다. 이때 adbdock이 만들었고 마지막으로 적용한
목적지와 여전히 일치하는 터널만 제거합니다. 외부에서 바뀐 규칙은 보존합니다.

### 무선 연결 복구

`adbdock pair --alias phone`을 사용하거나 Android Studio / ADB로 페어링·연결한 뒤
온라인 상태에서 alias를 저장합니다. watcher는 기억한 TLS 서비스의 현재 IP와 포트로
재연결할 수 있습니다. ADB 검색에서 일치하는 서비스가 없으면 macOS Bonjour로도
조회합니다. Metro 매핑이 없어도 사용할 수 있습니다.

무선 디버깅, 페어링, 네트워크 검색이 가능해야 합니다. 최초 페어링에는 폰의 코드 입력 또는 QR 스캔이
필요하고, 무선 디버깅 활성화는 자동화하지 않습니다. 예전에 저장한 주소를 추측해서
재접속하지 않습니다.
기존 `adb tcpip` 방식도 연결된 상태에서는 사용할 수 있지만, 이 검색 기반의 자동
재연결 대상은 아닙니다.

## 코딩 에이전트와 사용

플러그인 설치 방법은 [README](../README.ko.md#claude-code와-codex)를 참고하세요.
CLI와 플러그인은 어느 쪽을 먼저 설치해도 됩니다. 설치한 스킬이 현재 세션에 나타나지
않으면 새 세션을 시작하세요. 관련 작업에서 스킬이 자동 선택될 수 있지만 보장되지는 않습니다.

병렬 작업에서는 기기 별칭과 Metro 포트를 작업별로 배정하세요. adbdock은 자원을
예약하지 않으며, `ADBDOCK_HOME`을 분리해도 실제 기기와 reverse 규칙은 공유됩니다.

## 설정과 진단

| 설정 | 용도 |
|---|---|
| `ADBDOCK_HOME` | alias·매핑·watcher·로그를 별도 디렉터리로 분리 |
| `ADBDOCK_ADB` | 특정 ADB 실행 파일 사용 |

기본 경로는 `~/Library/Application Support/adbdock`입니다. alias와 매핑은
`config.json`, watcher 이벤트는 `watch.log`에 기록하며 로그는 약 1 MiB에서 순환합니다.

실패 원인은 `devices --json`과 `status --json`으로 확인합니다. JSON에는
`schemaVersion`, `ok`, `data`, `errors`가 있고, status에는 watcher 정보도 포함됩니다.
종료 코드는 성공 0, 작업·일부 기기 실패 1, 잘못된 인자 2, 대상 선택·가용성 오류 3,
watcher 제어 오류 4입니다. status 명령이 성공해도 개별 기기의 상태는 비정상일 수 있습니다.

## 제한 사항

- **터널 복구와 Fast Refresh 복구는 별개입니다.** RN 0.84.1 검증에서 끊어진 HMR 소켓은 명시적 앱 Reload가 필요했습니다. adbdock은 앱을 임의로 Reload하거나 상태를 초기화하지 않습니다.
- `status`는 ADB·reverse 규칙·호스트 Metro를 별도로 확인합니다. 앱 연결은 `unknown`으로 표시하므로 렌더링과 Fast Refresh는 앱에서 확인해야 합니다.
- 같은 AVD를 여러 개 실행하면 각각을 영구 식별할 고유 AVD 정보가 없습니다. 재시작 후에도 매핑을 유지하려면 서로 다른 AVD를 사용합니다.
- 실기기·에뮬레이터의 Metro 공유·분리, USB/Wi-Fi 전환과 복구를 짧게 검증했습니다. 짧은 Mac 잠자기·복귀 1회에서는 프로세스 생존, 기기에서 Metro까지의 HTTP 통신과 복귀 후 watcher 복구를 확인했습니다. 장시간 안정성은 아직 검증하지 않았습니다.

## 개발

adbdock 자체를 개발하려면 저장소를 복제해 실행합니다.

```sh
git clone https://github.com/floydkim/adbdock.git
cd adbdock
npm ci
npm run build
npm link
adbdock --help
```

소스를 업데이트할 때는 `git pull` 후 `npm ci && npm run build`를 실행합니다.
개발용 링크는 `npm unlink --global adbdock`으로 제거합니다.

소스 저장소에서 검증 명령을 실행합니다.

```sh
npm run check
npm run test:devices -- --device <serial-a> --device <serial-b>
npm run check:package
```

`check`는 타입 검사와 격리된 회귀 테스트를 실행합니다. `test:devices`는 명시한
실기기, 임시 포트·설정, 로컬 HTTP 검증 서버를 사용합니다. 앱을 설치하거나 RN 화면을
검증하지 않습니다. `check:package`는 실제 tarball, 개발 의존성 없는 설치,
CLI·watcher 실행과 publish dry-run을 검증합니다.

소스 저장소의 [testing.md](testing.md)에는 사람·LLM용 테스트 절차,
[manual-validation.md](manual-validation.md)에는 검증 기록, [releasing.md](releasing.md)에는 배포 절차가 있습니다.
npm 패키지에는 컴파일된 CLI JavaScript, 두 README와 LICENSE를 포함하며,
소스·테스트·플러그인·개발 문서·로컬 기기 데이터는 제외합니다.
