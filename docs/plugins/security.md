# Pack security · 팩 보안

한국어 요약은 아래에 있어요. Korean summary below.

## Model

A pack is **data**, not a program. JetDeck reads it, validates it, and runs only the commands you can see, on the Device, over your existing SSH connection. Nothing in a pack runs on your PC.

What a bad pack can still try: make you run a harmful command on the Device (for example by hiding it behind a harmless-looking name). JetDeck's defences:

* **Allow before use.** A pack from outside the app stays off until you open the allow dialog, which shows every command in full. Official packs shipped with the app are the only exception.
* **Changed file = allow again.** JetDeck remembers a fingerprint (SHA-256) of the file you allowed. If one byte changes, the pack turns off and the dialog highlights the changed commands.
* **Risk is computed by the app.** Only commands proven read-only run without asking. Everything else asks. If a pack claims a lower risk than the app computes, the app uses its own value and shows a warning. A pack can never lower a risk.
* **Fixed choices.** Choices come from the pack file and cannot contain shell special characters, so choosing one cannot inject a command.
* **Output protection.** Output is cleaned (control characters, ANSI codes, hidden direction/zero-width characters removed), secret-looking values are masked, and it is capped at 256 KB.
* **Safe mode.** Start JetDeck with `--safe-mode` to ignore every external pack.
* **Limits.** File size, number of items, regular-expression shape and run time are limited.

## Live output, input forms and values you type (5.1.0)

New abilities, and how each is limited:

* **Live output (`stream`).** The risk is a process that stays on the Device. JetDeck starts a stream only when you press Start, stops it when you press Stop, leave the screen, lose the connection or close the app (Ctrl-C first, then the channel is closed after 3 seconds), and stops it when `timeout` ends. Output speed and total size are capped (1 MB/s, 20 MB), 2 streams per pack and 4 in the app. Only a short list of endless read commands runs without asking; other streams ask first. Streams cannot use `sudo` or `auto`.
* **Input forms (`fields`).** A value you type could become a command (`a; rm -rf ~`). JetDeck inserts it as **one quoted word**, refuses a leading `-`, line breaks and control characters, limits the length, and refuses the pack when a `{name}` slot sits in a place where it could be read as code (inside quotes, as the command name, in `$( )`, in `sh -c`). Just before every run it **analyzes the filled command again**; a value that makes it riskier raises the risk and the dialog says why. The app's main process also checks that the command you confirmed is the command it runs.
* **Choices from the Device (`from`).** The list command must be read-only and runs by itself when the card opens. The Device could send bad text, so every line is checked against its `charset` and the chosen value goes through the same checks as typed text.
* **Output on screen.** Each line is cleaned and masked as above. One weak point stays: a secret that spans several lines (a private key printed to a log) is not masked line by line.

In the allow dialog, items show tags (`Live`, `Input`), and a box at the top lists everything that runs **without a click** (list commands, `auto` items). Read that box first.

## Reading the allow dialog

1. **Header counts** — how many items are read / change / danger. A pack with many danger items needs a reason.
2. **⚠ marks** — the pack says "read" but the app computed a higher risk. Treat this as a red flag.
3. **Command text** — read every command. Look for `curl`, `wget`, `ssh`, `base64`, `eval`, `sh -c`, `sudo`, `rm`, `>` redirects, and paths such as `~/.ssh` or `/etc/shadow`.
4. **Description is the author's words.** In confirmation boxes the app's own reasons come first, in the app's text; the pack's description is shown under a label so it cannot imitate the app.
5. **Turn it off or remove it** from the plugin manager at any time.

## Using packs safely

* Install packs only from authors you trust, and read the commands once.
* Prefer packs whose items are `read`; be careful with `danger`.
* Do not paste secrets into a pack. The pack file is plain text.
* Test a new pack on a Device that does not hold important data first.

## Reporting a problem

If you find a way for a pack to bypass the allow list or the risk analysis, report it **privately** (GitHub "Report a vulnerability"), see [SECURITY.md](https://github.com/Dawnilove/JetDeck/blob/main/SECURITY.md).

---

## 한국어 요약

* 팩은 프로그램이 아니라 **데이터**예요. 내 PC에서 실행되는 것은 없고, 보이는 명령만 Device에서 실행돼요.
* 외부 팩은 **허용 창에서 명령 전문을 보고 허용해야** 켜져요. 파일이 한 글자라도 바뀌면 **다시 허용**해야 해요.
* 위험도는 **앱이 계산**해요. 읽기로 증명된 명령만 묻지 않고 실행돼요. 팩이 낮게 적어도 앱 값이 우선이고 ⚠ 경고가 떠요.
* 선택지에는 셸 특수문자가 들어갈 수 없고, 출력은 정리·비밀 가림·256KB 제한을 거쳐요.
* `--safe-mode`로 시작하면 외부 팩을 모두 무시해요.
* 허용 창에서 `curl`·`wget`·`ssh`·`eval`·`sudo`·`rm`·민감한 경로가 보이면 의심하세요. 믿는 사람의 팩만 설치하세요.
* **실시간·입력·값 주의 (5.1.0).** 흐르는 출력(`stream`)은 시작·멈춤을 사용자가 누르고, 화면을 나가거나 연결이 끊기거나 앱을 닫거나 시간이 끝나면 멈춰요. 입력 값은 따옴표 처리한 단어 하나로만 들어가고, 앞의 `-`·줄바꿈·제어 문자는 거부돼요. 실행할 때마다 값을 채운 명령을 앱이 다시 분석해요. 기기에서 불러온 선택지(`from`)도 글자 종류를 검사해요. 한계: 여러 줄에 걸친 비밀(로그에 찍힌 개인 키)은 줄마다 가려지지 않을 수 있어요.
* 우회 방법을 찾으면 공개 이슈 대신 GitHub의 "Report a vulnerability"로 알려 주세요.
