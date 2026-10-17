# adbdock 테스트 실행 가이드

사람과 LLM이 새 환경에서 재실행하는 절차다. 과거 실행 결과는
[manual-validation.md](manual-validation.md)에 따로 기록한다.

## 1. 기본 회귀 테스트

저장소 루트, Node.js 22 이상에서 실행한다.

```sh
npm ci
npm run check
```

타입 검사와 CLI subprocess 회귀 테스트를 실행한다. ADB와 Bonjour는 fixture로
격리되며 실기기·Android SDK·Metro가 없어도 실행할 수 있다. macOS Bonjour
전용 테스트는 다른 OS에서 skip되므로, skip을 통과로 보고하지 않는다.
이 단계만으로 실제 Android 연결이나 RN Fast Refresh를 검증했다고 말하지 않는다.

## 2. 실제 기기 자동 회귀

필요한 것: PATH의 adb(또는 ADBDOCK_ADB), 연결·인증된 Android 기기/에뮬레이터,
기기 안의 toybox nc. Metro나 RN 앱, 새 패키지는 필요 없다.

```sh
adb devices -l
node dist/cli.js devices --json
npm run test:devices -- --device <ADB_SERIAL_A> --device <ADB_SERIAL_B>
```

`--device`는 실제 ADB serial이며 반복할 수 있다. 기본 설정의 alias를 전달하지 않는다.
USB/Wi-Fi가 같은 폰이면 둘 중 하나만 지정한다. 최소 한 기기부터 실행 가능하지만,
여러 기기의 공유·분리 검증에는 서로 다른 기기가 두 대 이상 필요하다.

보고서 위치를 지정할 수도 있다.

```sh
npm run test:devices -- --device <ADB_SERIAL> --report .test-results/my-run.json
```

확인 항목:

1. Metro 설정 없이 alias 저장과 지정 기기에 대한 ADB 명령 실행.
2. 모든 대상이 같은 호스트 포트에 연결되고, Android에서 보낸 HTTP 요청에
   해당 서버의 고유 marker가 반환되는지 확인.
3. 기기마다 다른 호스트 포트로 연결해 각 서버의 고유 marker 확인.
4. 테스트 터널 하나를 지운 뒤 watcher가 복원하는지 확인하고 실제 HTTP 재검증.
5. 호스트 서버 중지 시 reverse ready / server unreachable 구분, 다른 기기 통신,
   서버 재시작 후 통신 확인.
6. 테스트 포트의 외부 변경을 watcher가 덮어쓰지 않고, unbind도 보존하는지 확인.

스크립트는 자체 임시 설정, watcher, 호스트 HTTP 서버와 미사용 reverse 포트를
만든다. 기존 8081 등 reverse 규칙은 덮어쓰지 않는다. 원래 연결·실행 중인
watcher/Metro는 중지하지 않는다. 테스트용 충돌도 이 임시 포트에만 만든다.
Android 요청 시 stdin을 잠시 유지하는 것은 toybox nc가 전송 전에 종료하는
경우를 피하기 위한 것이다.

보고서의 `ok`, 각 `checks`, `cleanup.ok`가 모두 성공해야 통과다.
`configHome`, `devicePort`, `hostPorts`, watcher 로그와 실패 사유도 기록한다.
실패 및 SIGINT/SIGTERM에서도 정리를 시도한다. 이미 실행한 유한 CLI 명령은
최대 60초 제한 안에서 완료를 기다린 뒤 정리한다. 터널 생성 직후 부모 CLI만
종료되어 소유권 저장이 누락되는 문제를 피하기 위해서다. 정리 실패 시 설정을 남기고
종료 코드 1을 반환한다. SIGKILL, 기기 탈착, OS 종료에서는 정리를 보장할 수 없다.
그때는 보고서의 임시 설정·포트만 확인해 정리한다. 전체 reverse 삭제나
`adb kill-server`를 사용하지 않는다.

```sh
ADBDOCK_HOME=<REPORT_CONFIG_HOME> node dist/cli.js watch stop
ADBDOCK_HOME=<REPORT_CONFIG_HOME> node dist/cli.js metro unbind <smoke-alias> --device-port <REPORT_DEVICE_PORT>
adb -s <CURRENT_SERIAL> reverse --list
```

충돌 규칙은 unbind가 보존하므로, 보고서의 devicePort → hostPorts 중 테스트가
만든 규칙임을 확인한 경우에만 `reverse --remove tcp:<REPORT_DEVICE_PORT>`로
제거한다. 기기가 offline이면 재연결한 뒤 확인한다. 다른 도구가 다시 바꾼 규칙은
그대로 남긴다.

이 HTTP 서버는 Metro의 `/status` 응답을 흉내 낸다. **실제 RN 앱과 HMR 검증이 아니다.**
포트 분리는 테스트 요청의 목적지를 검증하며 기존 RN 앱을 변경하지 않는다.

## 3. LLM 실행 원칙과 증거

사용자가 요청한 범위부터 실행한다. 보통 1 → 2 → 필요할 때 4 순서다.

- 기기 목록과 현재 reverse를 먼저 읽고 사용자가 지정한 기기만 대상으로 삼는다.
- OS 잠자기, USB 탈착, 무선 디버깅 토글은 사용자가 할 때까지 기다린다.
  과거 실행 여부와 별개로 이번 실행의 사용자 조작을 기다린다. 실행 요청이 없는 앱 설치도 하지 않는다.
- 명령 성공, ADB 연결, reverse, 호스트 Metro, 앱 렌더링, Fast Refresh를 따로 기록한다.
  `status.app`은 unknown이며 UI 성공의 증거로 쓸 수 없다.
- 실패 시 명령/JSON/화면과 로그를 먼저 보존하고 원인부터 확인한다.
  반복 실행으로 최초 실패 증거를 덮어쓰지 않는다.
- 성공/실패/미검증/사용자 보류를 구분한다. 실행하지 않은 시나리오는 통과가 아니다.
- 보고서에는 날짜, OS/Node/ADB/RN 버전, 대상 기기, 사용 포트, 시나리오별 결과,
  측정 시작·끝의 의미와 1회 관측 여부, 남은 자원과 정리 결과를 적는다.

## 4. 실제 RN + Metro 검증 (요청 시)

### 준비

사용자 제공 테스트 앱을 우선한다. 없으면 업무용 앱과 별도인 임시 디렉터리에
RN 디버그 앱을 만든다. 기존 검증 버전은 RN 0.84.1 / Community CLI 20.1.0이며
최신 버전이라는 뜻은 아니다.

```sh
npx --yes @react-native-community/cli@20.1.0 init AdbDockProbe --version 0.84.1 --skip-install
# 생성된 프로젝트에서 npm install
# Android SDK/Java toolchain을 확인한 뒤 android/에서:
./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a
```

위 ABI는 기존 arm64 기기 검증 기준이다. 다른 ABI면 실제 기기에 맞춘다.
이전 환경에서는 Android Studio의 JBR 21로 빌드했다. 도구 경로를 그대로
가정하지 말고 현재 환경을 확인한다.

서로 구분되는 App.tsx를 가진 source root A/B를 준비한다. 같은 APK를 두 기기에
설치해도 된다. 각 root의 index.js/app.json 등록 이름은 설치한 앱과 같아야 한다.
B에서 A의 node_modules를 symlink로 공유한다면, 아래처럼 실제 디렉터리를
watchFolders에 포함한다. 독립 설치라면 필요 없다.

```js
const fs = require('node:fs');
const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [fs.realpathSync(path.join(__dirname, 'node_modules'))],
});
```

App.tsx에는 프로젝트 구분, 수정할 revision, 상태 유지 확인용 버튼을 둔다.
B는 A1 대신 B1, METRO A 대신 METRO B로 구분한다.

```tsx
import React, {useState} from 'react';
import {Button, Text, View} from 'react-native';
export default function App() {
  const [count, setCount] = useState(0);
  return (
    <View style={{padding: 32}}>
      <Text>METRO A</Text>
      <Text>Revision A1</Text>
      <Button title={`Counter: ${count}`} onPress={() => setCount(n => n + 1)} />
    </View>
  );
}
```

현재 포트와 reverse 사용을 확인하고 충돌 없는 포트를 택한다. 아래는 예시다:
A host 8081, B host 8082, 각 device 18081. 이미 사용 중이면 바꾼다.
별도 관리 터미널에서 각 root의 `npm start -- --port <HOST_PORT>`를 실행하고
이번 실행의 터미널/프로세스와 로그를 기록한다. 다른 Metro를 종료하지 않는다.

별도 `ADBDOCK_HOME`을 mktemp 디렉터리로 정하고 이후 모든 CLI에 전달한다.
기기별 alias를 저장하고 임시 APK를 명시적으로 선택한 기기에 설치한다.
설치 시 `adb --timeout 120000 --device ... -- install -r <APK>` 형태를 사용한다.

**두 앱의 개발자 메뉴에서 디버그 서버를 `localhost:18081`로 지정한다.**
에뮬레이터도 10.0.2.2를 쓰면 reverse를 우회하므로 이 검증에서는 사용하지 않는다.
앱별 주소를 확인하기 전에는 reverse 경로를 검증했다고 판정하지 않는다.

### 공유 / 분리 / Fast Refresh

아래 명령은 앞에서 정한 isolated ADBDOCK_HOME 환경에서 실행한다.

```sh
node dist/cli.js metro bind <ALIAS_A> --port 8081 --device-port 18081
node dist/cli.js metro bind <ALIAS_B> --port 8081 --device-port 18081
node dist/cli.js watch start --background
node dist/cli.js status --json
```

두 앱을 Reload해 METRO A/A1을 확인하고 카운터를 각각 1로 올린다.
화면 도구(예: agent-device)의 snapshot으로 text를 읽고 스크린샷을 남긴다.
App A의 A1 → A2 문자열만 바꾸면 두 기기 모두 A2 / Counter 1이어야 한다.

이후 B 기기만 호스트 B로 옮기고 Reload한다.

```sh
node dist/cli.js metro bind <ALIAS_B> --port 8082 --device-port 18081
```

B1 / Counter 0을 확인하고 카운터를 1로 올린다. A2 → A3 변경은 A에만,
B1 → B2 변경은 B에만 반영되고 카운터 1이 유지되어야 한다.
각 변경 전후 모든 대상의 화면을 확인한다. 라벨만 다른 초기 화면이나
카운터가 초기화된 전체 Reload를 Fast Refresh 통과로 보지 않는다.

Metro B만 중지해 reverse 유지/server unreachable/A 갱신을 확인하고 재시작한다.
B의 HMR이 끊겼으면 명시적 Reload 후 카운터를 다시 올리고 다음 revision으로
Fast Refresh를 확인한다. 이를 자동 HMR 복구 성공으로 기록하지 않는다.

### 사람의 조작이 필요한 선택 시나리오

| 시나리오 | 절차 / 판정 |
|---|---|
| USB → Wi-Fi | 최초 페어링 완료 및 서비스 이름 저장 → Wi-Fi 경로 확인 → USB만 남김 → 사용자 USB 탈착 → watcher connect/실제 ID/reverse 확인. 다른 기기 갱신도 확인 |
| Wi-Fi 포트 변경 | USB 복구 경로가 있을 때만 사용자가 무선 디버깅 토글 → 새 서비스 주소 확인 → USB 탈착 후 새 주소 연결. 연결된 유일한 경로를 무작정 끄지 않음 |
| Bonjour 보완 | 실제 dns-sd 응답과 ADB mdns를 비교. 빈 ADB 목록 주입 시험은 원래 adb를 전달하는 임시 래퍼와 별도 watcher로 하고, 실제 탈착/주입 여부를 구분해서 기록 |
| Mac 잠자기 | 사용자 동의 시 30~60초 정도 짧게 잠자기 후 복귀. watcher 생존, 발견 재개, connect/reverse/호스트 상태 확인. 잠자기 방지 caffeinate를 동시에 사용하지 않음 |
| IP 변경 | 선택 검증. 저장 IP가 아니라 서비스의 현재 주소를 쓴다는 동작 확인. 현 단계 필수 조건 아님 |
| 장시간 사용 | 사용자가 실제 업무에서 검증. 필요 시 문제가 발생한 시각의 status/watch.log 수집 |

시간 측정은 polling에서 처음 USB 부재를 관측한 시각과 connect/reverse 검증 시각을
기록한다. 사용자의 “뺐음” 메시지 시각을 실제 탈착 시각으로 취급하지 않는다.
프로세스 SIGSTOP/SIGCONT만으로 실제 Mac 잠자기를 검증했다고 하지 않는다.
RN 0.84.1에서는 끊어진 HMR 소켓이 자동 재연결되지 않았다. 명시적 Reload 이후의
정상 동작과 ADB/터널 자동 복구를 분리한다.

### 종료와 정리

1. 증거와 isolated config/watch.log를 복사한다.
2. 해당 ADBDOCK_HOME의 watcher만 stop한다.
3. 이번에 만든 기기 포트별 metro unbind를 실행하고 reverse를 확인한다.
4. 이번 실행에서 만든 Metro 터미널/프로세스만 종료한다.
5. 테스트 앱·AVD 삭제는 이번 실행에서 만든 것만 대상으로 한다. 사용자가 계속
   사용할 예정이면 보존하고 남겨 둔 항목을 보고한다.
6. 기존 업무용 설정·기기·Metro·다른 watcher가 유지되는지 확인한다.


## 5. 최초 무선 페어링 (요청 시)

Android 11 이상 폰의 페어링 코드 화면을 사용자가 연다. 기존 페어링을 삭제하지 않는다.
`adbdock pair --list --json` → `adbdock pair --alias <name>`으로 대상 선택·코드 입력을
확인한다. 에이전트는 명시적 페어링 주소와 `--code-stdin --json`으로 코드를 전달한다.
코드를 명령 인자·증거 파일·로그에 남기지 않는다. 대화로 전달하면 대화에는 남는다.

성공은 paired/connected 모두 true, 검증된 하드웨어 ID, 저장된 alias/무선 서비스,
기존 Metro 매핑 보존으로 판정한다. 자동 검색이 비면 별도 연결 포트의 `--connect`를
사용한다. 잘못된 코드·취소·별칭 충돌·부분 성공은 fake ADB 회귀 테스트로 확인한다.
실제 재페어링과 최초 신뢰 수립은 구분해서 기록한다.


QR 검증은 `adbdock pair --qr --alias <name>` 실행 후 사용자가 폰의 무선 디버깅
QR 스캐너로 스캔한다. 60초 제한은 `--timeout <ms>`로 조정할 수 있다. QR 자체는
일시적인 인증 정보이므로 검증 기록에는 QR 대신 최종 paired/connected와 등록 결과를 남긴다.
`adbdock alias`에서 기기 선택·신규 이름·현재 이름 변경·오프라인 기기·취소를 확인한다.
기존 명령형 alias와 Metro 매핑이 유지되어야 한다.

## 6. 저장한 명령 alias

기본 `npm run check`에 명령 등록·덮어쓰기·삭제·대화형 편집, 여러 대상·인자 전달,
파일명 충돌·PNG 바이너리 보존·다중 디스플레이, 기기별 reverse 매핑,
동시 수정 충돌, 부분 실패·시간 초과·Ctrl+C와 자식 프로세스 정리가 포함된다.
`npm run check:package`는 설치된 패키지의 기본 목록과 등록·실행·삭제도 검사한다.

실기기에서는 별도 작업 디렉터리와 `ADBDOCK_HOME`을 사용한다.
`@screenshot -d <device> --json`의 파일 경로·PNG 헤더·크기를 확인한다.
reverse 검증은 기존 `adb -s <serial> reverse --list`를 먼저 저장하고, 사용하지 않는
기기 포트로 임시 매핑을 작성해 무인자·명시적 인자 동작을 각각 확인한다.
저장 설정이 바뀌지 않았는지 확인한 뒤 이번에 만든 규칙만 제거하고 원래 목록과 비교한다.
에뮬레이터가 꺼져 있으면 실기기 다중 대상 검증을 했다고 기록하지 않는다.
`@shake`는 앱 UI를 바꾸므로 필요할 때만 실행하고 개발자 메뉴를 직접 확인한다.
