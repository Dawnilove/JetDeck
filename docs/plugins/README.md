# JetDeck plugin packs · 플러그인 팩

JetDeck 5.0 can be extended with **packs**: JSON files that describe commands to run on your Device and how to show the result (text or a table), with buttons and confirmation boxes. A pack holds **no code** that runs on your PC — everything runs on the Device over your existing SSH connection.

JetDeck 5.0은 **팩**으로 기능을 늘릴 수 있어요. 팩은 Device에서 실행할 명령과 결과 표시 방식(글자·표), 버튼, 확인창을 적은 JSON 파일이에요. 팩에는 내 PC에서 실행되는 코드가 **없어요.**

## 목차 · Contents
* [형식 설명서 (한국어)](format.ko.md) · [Format reference (English)](format.md)
* [보안 · Security](security.md)
* [JSON Schema](jdpack.schema.json) — `"$schema"` 한 줄로 VS Code 자동 완성
* [예제 · Examples](examples/examples.jdpack.json) — 내 프로젝트·센서·학습 작업 템플릿

## 5분 만에 첫 팩 만들기

1. 메모장이나 VS Code로 `hello.jdpack.json` 파일을 만들고 아래 내용을 붙여 넣어요.

```json
{
  "$schema": "https://dawnilove.github.io/JetDeck/plugins/jdpack.schema.json",
  "id": "hello",
  "format": 1,
  "version": "1.0.0",
  "name": "Hello",
  "plugins": [
    {
      "id": "info",
      "title": "시스템 정보",
      "actions": [
        {
          "id": "kernel",
          "label": "커널 버전",
          "cmd": "uname -a",
          "risk": "read",
          "auto": true,
          "display": { "type": "text" }
        },
        {
          "id": "disk",
          "label": "디스크 사용량",
          "cmd": "df -hP -x tmpfs -x devtmpfs",
          "risk": "read",
          "display": { "type": "table", "split": "ws", "skip": 1, "columns": ["장치", "크기", "사용", "남음", "사용률", "위치"] }
        }
      ]
    }
  ]
}
```

2. JetDeck의 환경 설정 메뉴에서 **플러그인 관리…**를 열어요.
3. **팩 설치…**를 눌러 파일을 골라요. 확인 창에서 **설치**를 누르면 팩이 꺼진 채로 들어와요.
4. 목록에서 **켜기**를 누르면 허용 창이 떠요. 모든 명령과 앱이 계산한 위험도를 읽고 **허용하고 켜기**를 눌러요. (팩은 허용하기 전에는 켜지지 않아요.)
5. 활동 막대에 **플러그인** 버튼이 생겨요. 눌러서 "커널 버전"이 자동으로 실행되는지 확인해요.
6. 파일을 고치면 앱이 바뀐 것을 알아채고 **다시 허용**을 요구해요. 이것은 정상이에요.

도움이 되는 순서: 예제 팩을 복사 → `id`·경로·명령을 내 것으로 바꾸기 → 설치. `risk`를 모르겠으면 `change`로 적으세요. 앱이 어차피 더 높은 쪽을 써요.

## Your first pack in 5 minutes (summary)

1. Create `hello.jdpack.json` with the JSON above (any text editor; the `"$schema"` line gives auto-complete in VS Code).
2. Open **Plugin manager…** from the settings menu and click **Install pack…** and confirm; the pack arrives turned off.
3. Click **Turn on** in the list. The allow dialog lists every command and the risk JetDeck computed; read it and click **Allow and turn on**. Packs never run before you allow them.
4. A **Plugins** button appears in the activity bar. Open it; "Kernel version" runs automatically (it is proven read-only).
5. If you edit the file later, JetDeck notices the change and asks you to allow it again.

Tip: copy an example pack and change the `id`, paths and commands. If unsure about `risk`, write `change` — JetDeck always uses the higher of your value and its own analysis.

## Share a pack · 팩 공유
Pack contributions are welcome: see "팩 기여 / Contributing packs" in [CONTRIBUTING.md](https://github.com/Dawnilove/JetDeck/blob/main/CONTRIBUTING.md).
