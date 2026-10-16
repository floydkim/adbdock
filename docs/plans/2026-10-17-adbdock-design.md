# adbdock 설계

상태: 사용자 승인 범위를 바탕으로 작성. 이름은 adbdock으로 확정. Node.js/TypeScript 선택은 구현 제안이다.

## 목적

Mac에서 USB 실기기, Wi-Fi 실기기, 여러 에뮬레이터를 동시에 관리하고 선택한 여러 기기에 ADB 명령을 실행한다. Metro 연결은 선택 기능으로 기기별 포트 매핑을 저장하고 복구한다. 사람과 LLM 모두 비대화형 CLI로 사용한다.

## 첫 버전 범위

- 기기 목록과 별칭, 연결 상태 표시
- 선택한 기기들 또는 전체 온라인 기기에 일반 ADB 명령을 실행하고 기기별 결과 표시
- Metro 설정 없이 기기 조회·별칭·ADB 명령 실행 가능
- 기기별 devicePort → metroPort 매핑 저장; devicePort 기본값 8081
- 여러 기기가 같은 Metro를 사용하거나 서로 다른 Metro 사용
- 연결 변경 감시, reverse 누락 복원, 알려진 무선 기기 재연결 시도
- 포그라운드/백그라운드 감시, 상태 조회, 단발 복구, 중지
- 구조화된 JSON 결과, 안정적인 종료 코드

메뉴바 앱, MCP 서버, Metro 실행, 전용 빌드/설치 워크플로, 로그인 시 자동 시작은 후속 범위다. 무선 디버깅 최초 페어링과 USB 인증은 기존 ADB/Android 절차를 사용한다. 자동 재연결과 최초 페어링은 별개다.

## 사용 예시

```sh
adbdock devices --json
adbdock alias <serial> pixel
adbdock adb --device pixel -- shell input keyevent 82
adbdock adb --device pixel --device galaxy -- shell pm list packages
adbdock adb --all -- install ./app.apk
adbdock adb --all --json -- shell getprop ro.product.model
adbdock metro bind pixel --port 8081
adbdock metro bind galaxy --port 8082
adbdock metro bind emulator-5556 --port 8083
adbdock metro bind galaxy --port 8082 --device-port 8082
adbdock watch
adbdock watch --background
adbdock status --json
adbdock metro repair --device galaxy
adbdock metro repair --all
adbdock metro unbind galaxy
adbdock stop
```

`bind`는 기기가 온라인일 때 매핑을 등록하고 즉시 적용한다. 온라인이었던 기기의 저장된 별칭은 오프라인일 때도 설정을 변경할 수 있다. 단발 명령 후 지속 복구에는 watch가 필요하다. 대상 생략이나 복수 일치는 실패하며 임의로 첫 기기를 선택하지 않는다.

`watch`는 저장된 매핑만 관리한다. 감시 중 연결된 새 기기에 임의로 프로젝트를 배정하지 않는다. 한 기기에 여러 매핑은 서로 다른 devicePort로 허용한다. 동일 기기/devicePort에 다시 bind하면 관리 중인 매핑을 변경한다. unbind에 매핑이 여럿이면 --device-port가 필요하다.

## 일반 ADB 명령 실행

`adb` 하위 명령은 하나 이상의 --device 또는 --all을 필수로 받는다. 대상 옵션과 ADB 인자는 --로 구분한다. 선택된 기기를 먼저 확정한 뒤 각 transport에 -s를 지정해 제한된 동시성으로 실행한다. --all은 실행 시작 시점의 온라인 기기 목록을 고정한다. 인증 필요/오프라인 기기는 별도 결과로 표시하며 명령을 보내지 않는다.

기기별 stdout, stderr, exitCode를 보존하고 일부 실패해도 나머지를 계속 실행한다. 명령을 자동 재실행하지 않는다. 프로세스 timeout이나 연결 단절 후에는 실제 명령이 적용되었을 수 있음을 결과에 표현한다.

첫 버전은 install, shell 등 유한하게 끝나는 기기 대상 명령을 지원한다. logcat, shell 대화형 세션 등 지속 스트림·TTY와 devices, connect, kill-server 등 호스트 대상 명령은 이 fan-out 인터페이스에서 지원하지 않는다. 대상을 바꾸는 -s/-t/-d/-e 또는 별도 ADB 서버 옵션을 전달받으면 거부한다. shell 명령의 기기 내부 셸 해석은 ADB 자체 동작을 따르며 Mac 셸을 추가로 거치지 않는다.

일반 ADB 명령으로 reverse 규칙을 직접 바꾸면 watch의 저장된 매핑과 충돌할 수 있다. 감시는 충돌 상태를 보고하고 외부 변경을 무조건 덮어쓰지 않는다. 감시가 일반 명령을 기록하거나 재실행하지 않는다.

## 포트 매핑

| 기기 | 기기 포트 | Mac Metro 포트 |
|---|---|---|
| Pixel USB | 8081 | 8081 |
| Galaxy Wi-Fi | 8081 | 8082 |
| Emulator A | 8081 | 8081 |
| Emulator B | 8081 | 8083 |

Galaxy 명령: `adb -s <현재 transport serial> reverse tcp:8081 tcp:8082`.

앱이 실제로 기기 localhost:devicePort를 사용해야 한다. 앱에 Mac IP나 다른 서버 주소가 지정되어 있으면 reverse 설정만으로 이를 바꾸지 않는다. 같은 기기의 같은 포트를 두 Metro에 동시에 연결할 수 없다.

## 구성

Node.js 22 이상과 TypeScript를 사용한다. 외부 adb 실행 파일을 사용하며 ADB 프로토콜을 직접 구현하지 않는다. 초기에는 Node 내장 인자 파서와 테스트 러너를 사용한다.

- CLI: 인자 처리와 표/JSON 출력
- ADB 어댑터: 기기 조회, 식별, 일반 명령 fan-out, reverse, 무선 검색/연결
- 연결 관리: 설정과 실제 상태 비교, 복구 정책
- 감시 프로세스: 주기 조회, 재시도, 백그라운드 수명 관리
- 로컬 저장: 설정과 런타임 상태

감시 주기는 우선 약 2초로 시작하고 실제 사용에서 조정한다. 단순 조회 방식으로 시작하며 track-devices 이벤트 처리는 필요가 확인된 후 추가한다.

백그라운드 감시 프로세스는 하나만 실행한다. 실행 중에는 로컬 Unix socket을 통해 CLI 변경 명령을 받아 설정 변경과 ADB 쓰기를 직렬화한다. 감시가 없을 때 단발 변경은 같은 잠금 아래 같은 연결 관리 로직을 실행한다. 실행 중인 프로세스 식별과 종료는 PID 숫자만 믿지 않고 소켓 응답 및 실행 식별자로 확인한다. stop은 감시를 종료하며 설정과 reverse는 보존한다.

## 저장과 기기 식별

설정은 사용자별 Application Support/adbdock에 저장한다. 설정 파일은 원자적으로 교체하고 런타임 로그와 상태는 분리한다. 저장 형식에는 schemaVersion을 둔다.

기기 식별자와 현재 ADB transport serial은 분리한다. USB와 Wi-Fi가 동일 실기기로 확실히 식별될 때만 하나로 묶고 USB를 우선한다. 식별 근거가 없거나 중복되면 사용자에게 명시적인 transport 선택을 요구한다. 모델명만으로 기기를 합치지 않는다.

에뮬레이터는 조회 가능한 AVD 이름을 저장 식별에 활용하고 현재 emulator-NNNN 주소는 실행 시 다시 확인한다. 동일 AVD가 복수 실행되거나 식별이 모호하면 자동 배정을 멈추고 명시적인 대상을 요구한다.

무선 연결은 알려진 기기의 mDNS 서비스와 현재 endpoint를 확인한다. 지원되는 mDNS 출력 및 기기 식별 정보는 구현 전 실제 설치된 adb로 확인한다. 오래된 ip:port로 무제한 재시도하거나 발견된 모든 기기에 연결하지 않는다. 확실한 식별이 불가능하면 수동 재연결 필요 상태로 둔다.

## 복구 정책

1. 연결된 기기와 현재 transport를 확인한다.
2. 인증 필요/오프라인이면 reverse 실행을 보류한다.
3. reverse --list 결과와 저장한 매핑을 비교한다.
4. 누락된 매핑을 생성하고 다시 조회해 확인한다.
5. 외부 규칙이 같은 devicePort를 다른 대상으로 사용하면 충돌을 표시한다. 명시적인 --replace에서만 덮어쓴다.
6. 관리 중 매핑 변경/삭제도 현재 규칙이 마지막으로 관리한 값과 일치할 때만 교체/삭제한다.
7. 실패는 기기별로 기록하고 재시도 간격을 늘려 최대 간격을 제한한다. 다른 기기의 복구는 계속한다.

명령별 timeout을 두고 동시 작업 수를 제한한다. 실패했다고 adb kill-server, 전체 reverse 삭제, Metro 재시작, 앱 데이터 삭제를 자동 실행하지 않는다.

## 상태와 LLM 인터페이스

ADB 상태, reverse 상태, Mac의 Metro 응답을 별도 필드로 제공한다. Metro 매핑이 없는 기기는 metro를 not_configured로 표시하며 서버 조회를 하지 않는다. Mac에서 Metro가 응답하고 reverse가 존재해도 실제 앱 연결이나 Fast Refresh 성공으로 표시하지 않는다. 앱 수준 연결은 unknown이다.

JSON은 schemaVersion, ok, data, errors를 사용한다. JSON 모드 stdout에는 결과 하나만 출력하고 진행 로그는 stderr로 보낸다. errors에는 code, deviceId, message, retryable을 포함한다. 부분 성공 결과도 보존한다.

종료 코드: 0 성공, 1 작업 실패/부분 실패, 2 인자 오류, 3 대상 없음/모호함, 4 감시 프로세스 제어 오류. status의 명령 성공과 개별 기기의 건강 상태는 구분한다. Metro가 꺼졌다는 이유만으로 status 조회 자체를 실패시키지 않는다.

## 검증 기준

가짜 adb 실행 파일을 이용한 경계 테스트로 대상 지정, 명령 인자, 복구, timeout, 부분 실패, JSON 출력을 검증한다. 내부 구현을 그대로 따라가는 테스트나 테스트 전용 production export는 추가하지 않는다.

수동 검증은 USB 실기기 + Wi-Fi 실기기 + 에뮬레이터 2대로 수행한다. 같은/다른 Metro 포트, USB 재연결, 무선 주소 변경, 잠자기 복귀, Metro 재시작, 같은 실기기의 USB/Wi-Fi 동시 노출을 확인한다. 실제 앱에서 각 프로젝트의 변경이 올바른 기기에 반영되는지 확인해야 동시 운영 검증이 끝난다.

## 참고

- ADB 기기 선택: https://developer.android.com/tools/adb?hl=en#directingcommands
- ADB reverse 명세: https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/docs/user/adb.1.md
- RN 개발 서버 연결: https://reactnative.dev/docs/running-on-device
