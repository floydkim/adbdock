# adbdock

[English](README.md) | **한국어**

여러 Android 기기를 동시에 연결해 놓고 하나의 CLI로 관리합니다. 기기에 별칭을 붙여
ADB 명령을 간편하게 실행할 수 있습니다. React Native 개발 시에는 기기별 Metro 연결을
설정해 두면 연결이 끊어지더라도 자동으로 복구해 줍니다.

## 왜 만들었나요?

USB 실기기, 무선 기기, 에뮬레이터를 함께 사용하다 보면 serial을 확인하고 `adb -s`를
반복해서 입력하게 됩니다. 연결이 끊기면 `adb reverse`를 복구해야 하고, 프로젝트가
여럿이면 기기마다 어떤 Metro에 연결할지도 기억해야 합니다.

adbdock은 이 선택을 기억해 줍니다.

- **기기에 이름 붙이기:** ADB serial 대신 `phone`같은 별칭을 사용할 수 있습니다. 같은 실기기가 USB와
  Wi-Fi에 모두 연결되어 있으면 하나로 묶고 USB를 우선 사용합니다.
- **여러 기기에 명령 실행:** 한 기기, 선택한 여러 기기, 온라인 기기 전체를 지정할 수
  있습니다. adb 명령어들을 단축 명령어를 저장할 수 있습니다.
- **Metro 연결 유지:** 하나의 Metro 포트를 공유하거나 기기마다 다른 포트에 연결할 수 있습니다.
  watcher를 사용하면 끊긴 연결을 자동으로 복구할 수 있습니다.
- **코딩 에이전트와 사용:** JSON 출력과 선택적으로 설치하는 Claude Code·Codex 스킬로
  에이전트가 작업할 기기를 지정할 수 있습니다.

Metro는 선택 사항입니다. 기기 별칭과 ADB 명령만 사용할 수도 있습니다.

## 설치

**macOS**, **Node.js 22 이상**, Android SDK Platform-Tools가 필요합니다.
`adb`가 PATH에 있어야 합니다.

```sh
npm i -g adbdock
adbdock --help
```

전역 설치 없이 실행해 볼 수도 있습니다.

```sh
npx adbdock@latest --help
```

npm으로 전역 설치한 CLI를 업데이트하거나 제거하려면:

```sh
adbdock upgrade
adbdock uninstall
```

현재 watcher가 실행 중이면 먼저 `adbdock watch stop`으로 중지합니다.
제거 후에도 설정과 로그는 보존합니다. 이 명령이 없는 이전 버전에서는
`npm i -g adbdock@latest` 또는 `npm uninstall -g adbdock`을 사용합니다.

## 빠르게 시작하기

USB 디버깅 인증을 마친 기기를 연결하거나 에뮬레이터를 실행합니다.
무선 기기는 [무선 페어링](#무선-페어링)으로 연결할 수 있습니다.

**1. 기기 목록을 확인하고 이름을 붙입니다.**

```sh
adbdock devices  # 연결된 기기들 확인
adbdock alias    # 기기 별칭 확인 및 편집
```

`alias`에서 기기를 선택하고 이름을 입력합니다. 다른 기기에도 이름을 붙이려면 다시
실행합니다. 아래 예시는 두 기기에 각각 `phone`, `emulator`라는 이름을 붙였다고
가정합니다. 별칭은 설정 파일에 저장됩니다. 이미 기억된 기기는 오프라인 상태에서도 별칭을 변경할 수 있습니다.

**2. ADB 명령을 실행합니다.**

```sh
adbdock adb -d phone -- shell getprop ro.product.model
```

`--` 뒤의 내용이 ADB에 전달됩니다. 여러 기기를 대상으로 실행하기 위해 `-d` 옵션을 반복 입력할 수 있고,
`--all` 옵션을 쓰면 온라인 기기 전체를 대상으로 실행합니다.

```sh
# phone, emulator 기기 대상으로 실행
adbdock adb -d phone -d emulator -- shell getprop ro.product.model
# 모든 온라인 기기 대상으로 실행
adbdock adb --all -- install -r ./app.apk
```

온라인 기기가 한 대뿐이면 실행 대상을 생략해도 됩니다.

```sh
adbdock adb -- shell getprop ro.product.model
```

**3. 기본 내장된 단축 명령어도 실행해 보세요.**

```sh
adbdock @menu -d phone
adbdock @screenshot -d phone -d emulator
```

`@menu`는 React Native 개발자 메뉴를 엽니다. `@screenshot`은 현재 디렉터리에
기기마다 별도의 PNG를 저장하고 경로를 출력합니다.

단축 명령어를 더 추가하거나 편집할 수 있습니다.

## React Native: Metro 연결과 자동 복구

각 프로젝트의 Metro 서버는 직접 실행해주세요. 아래 예시는 앱의 개발 서버 주소가
`localhost:8081`인 경우입니다. 다른 주소를 사용 중이라면 adbdock의 터널을 이용하도록
앱 설정을 변경해야 합니다. 기기 쪽 포트는 `--device-port`로 변경할 수 있습니다.

adbdock은 앱 설정을 변경하지 않습니다. 앱이 기기 자신의 `localhost:8081`로 보내는
요청을 ADB reverse를 통해 지정한 Mac의 Metro 포트로 전달합니다.

각 기기를 서로 다른 Metro 포트에 연결하고 연결을 유지하도록 watcher를 실행할 수 있습니다.

```sh
adbdock metro bind phone --port 8082
adbdock metro bind emulator --port 8081
adbdock watch start --background
```

| 기기 별칭 | Android 앱이 접속하는 주소 | Mac의 Metro 포트 |
|---|---|---|
| phone | `localhost:8081` | `8082` |
| emulator | `localhost:8081` | `8081` |

`--port`는 **Mac의 Metro 포트**입니다. 만약 하나의 Metro를 공유하려면 두 기기에 같은
포트를 지정하면 됩니다. 그리고 watcher를 실행하면 연결이 끊어졌을 때 자동 복구합니다.
백그라운드 watcher는 터미널을 닫아도 계속 실행됩니다.

watcher 상태 확인과 중지는 다음 명령을 사용합니다.

```sh
adbdock watch status
adbdock watch stop
```

watcher를 중지해도 저장된 매핑과 현재 터널은 유지됩니다.

**터널 복구가 Fast Refresh 복구를 보장하지는 않습니다.** 연결이 끊긴 뒤에는 앱에서 Reload가 필요할 수 있습니다.

## 무선 페어링

Android 11 이상에서 폰과 Mac을 같은 Wi-Fi에 연결하고 실행합니다.

```sh
adbdock pair --qr --alias phone
```

폰에서 **개발자 옵션 → 무선 디버깅 → QR 코드로 기기 페어링**을 열고 터미널의
QR을 스캔합니다. adbdock이 폰을 연결하고 별칭을 저장합니다.

코드를 입력하려면 **페어링 코드로 기기 페어링**을 열고
`adbdock pair --alias phone`을 실행한 뒤 표시된 6자리 코드를 입력합니다.

페어링만으로 watcher가 시작되지는 않습니다. 기억된 무선 기기에 자동으로 다시
연결하려면 `adbdock watch start --background`를 실행합니다. Metro 없이도 사용할 수
있으며, 무선 디버깅이 켜져 있고 기기를 네트워크에서 검색할 수 있어야 합니다.

## 더 알아보기

| 명령                           | 용도                                        |
| ---------------------------- | ----------------------------------------- |
| `adbdock alias`              | 기기를 선택해 별칭 설정/변경                      |
| `adbdock @reverse -d phone`  | 저장된 Metro 포트 매핑 적용 (저장된게 없으면 8081 → 8081) |
| `adbdock adb-alias`          | ADB 명령 단축어 저장/편집/삭제                       |
| `adbdock status`             | 기기, Metro 연결, watcher 상태 확인               |
| `adbdock metro unbind phone` | 별칭이 `phone`인 기기의 기본 Metro 매핑 제거 |

`adbdock --help`로 전체 명령 목록을 확인할 수 있고, 각 명령어마다 도움말에서 옵션과 예시를 볼 수 있습니다.

```sh
adbdock adb --help
adbdock metro bind --help
adbdock adb-alias --help
```

`shell`, `install`, `push` 등의 비대화형 명령을 지원합니다. 대화형 셸과 스트리밍 명령은 지원하지 않습니다.
기본 제한 시간은 10초이며, 오래 걸리는 작업은 `--` 앞에 `--timeout 120000`을 지정해 늘릴 수 있습니다.

사용자 정의 명령의 변수, 페어링 문제 해결, 복구 동작과 설정은
[사용 가이드](https://github.com/floydkim/adbdock/blob/main/docs/usage.ko.md)를 참고하세요.

## Claude Code와 Codex

사용하는 코딩 에이전트의 스킬 플러그인을 설치할 수 있습니다.
CLI와 플러그인은 어느 쪽을 먼저 설치해도 됩니다. 에이전트가 스킬을 사용할 때 CLI가 설치되어 있지 않으면 설치 명령을 안내합니다.

**Claude Code**

```sh
claude plugin marketplace add floydkim/adbdock
claude plugin install adbdock@adbdock
```

**Codex CLI**

```sh
codex plugin marketplace add floydkim/adbdock
codex plugin add adbdock@adbdock
```


## 개발

[개발 가이드](https://github.com/floydkim/adbdock/blob/main/docs/usage.ko.md#개발)와
[테스트 절차](https://github.com/floydkim/adbdock/blob/main/docs/testing.md)를 참고하세요.

## 라이선스

[MIT](LICENSE)
