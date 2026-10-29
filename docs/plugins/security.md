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

## Charts (5.2.0)

* **Charts (`chart`).** The risk is a command that runs again and again on the Device. A chart item must be **proven read-only by the app** (a pack that claims `read` is not enough; the item is dropped otherwise), and cannot use `sudo`, `preview`, `fields` or `params`. JetDeck starts it only when you press Start (or when the screen opens for `auto`, which is listed in the allow dialog with its interval), and stops it when you press Stop, leave the screen, lose the connection or close the app. Each run is one short command with a time limit (default 10 s, max 30 s), so nothing stays on the Device. Limits: interval at least 1 s for packs you install, a read is skipped while the last one still runs, a slow command makes the interval longer, 5 failures in a row stop the chart, 5 charts per pack and 10 in the app.
* **Numbers only.** JetDeck reads at most 256 KB and 1000 lines per run (cleaned like all output), accepts only plain finite numbers (up to 1e9 after scaling), and puts only letters, digits and `_ . -` (20 characters) from the output into a line name. Output text is never drawn on the chart; the card shows at most one cleaned line of output, and only when no number could be read. Data stays in memory.

## Explorer badges, and anything that runs when you open a folder (5.3.0)

Badges are the one place where a pack command runs **without a click**: opening a folder in the Explorer is enough. The Git marks built into JetDeck (since 4.1.0) behave the same way. Threats and defences:

* **The pack could run a harmful command on every folder.** A badge command must be **proven read-only by the app** twice: when the pack loads, and again just before each run with the real folder name filled in (a folder such as `~/.ssh` is skipped quietly). It cannot use `sudo`, redirects or any other slot than `{dir}`. The allow dialog lists every badge command in full in a box named "Runs automatically", marked "When you open a folder". An external pack stays off until you allow it.
* **A folder name could become a command.** `{dir}` is inserted as one quoted word; control characters are refused; the filled command is analyzed again.
* **A repository you do not trust could make Git run programs.** Git reads settings stored inside a repository, and some settings start programs. A repository can come from a downloaded archive or someone else's clone, so opening it in the Explorer must not be enough. Before JetDeck runs `git` it checks the repository's own settings, and **it does not run Git when they could start a program** (the folder shows a ⚠ with the reason). It also turns off hooks, signature-check programs, pagers, and Git's optional index writes. The same guard runs before **every** pack item that uses `git` (buttons, previews, live views, charts, `from` lists) and before the Explorer's built-in Git marks. Limits: repositories with local filter settings, for example Git LFS installed per repository, are refused too (safe side); a pack command that starts `git` through another program (`env`, `xargs`, `find -exec`) does not pass the guard, so it is not treated as read-only and asks first; your own shell and global Git settings are trusted.
* **A slow or huge repository could slow the Device.** At least 3 s between runs of the same folder, one run at a time per connection, 15 s time limit, 3 time-outs in a row stop the badge, at most 5000 records, 1 MB of output.
* **Text on the screen could mislead.** A mark is 1–2 characters, its color comes from the app, and the pack's words appear only in the tooltip.
* **You can always stop it.** The **Explorer badges** switch in the plugin manager, switching the pack off, or `--safe-mode`.

In the allow dialog, items show tags (`Live`, `Input`, `Chart`), and a box at the top lists everything that runs **without a click** (list commands, `auto` items). Read that box first.

## Gallery (5.5.0)

The gallery downloads a list of packs from the network, so it has its own defences:

* **Signed list.** The list (`index.json`) is signed with the maintainer's ed25519 key, which never leaves the maintainer's PC. The app checks the signature **before** it parses the list. A list with a wrong or missing signature is not shown (the last good list is, marked as offline). The public key is built into the app. A build without a public key rejects every list.
* **No rollback, no stale list.** The app remembers the highest `serial` it has seen and rejects a lower one. After `expires` (4 years after the list was built) the list is shown but new installs are blocked.
* **Fingerprints.** A pack file is downloaded only when you press **View contents**. Its size and SHA-256 must equal the signed list, the app validates it again with its own validator, and the id and version must match. What you allow is the exact file you were shown.
* **Fixed addresses, HTTPS only.** The two download addresses are constants in the app (the list and the packs cannot point to another server), redirects are refused, and size and time are limited (list 1 MB, pack 128 KB, 15 s). The app sends only a fixed `User-Agent` (`JetDeck/<version>`) and a cache check: no cookies, no device information, no list of your packs, no search terms (searching happens on your PC). Nothing is downloaded when the app starts, only after you open the Gallery tab and agree to the notice. A released app ignores any setting that changes the address.
* **Withdrawn packs.** The maintainer can withdraw a pack by id, version or fingerprint. A withdrawn pack cannot be installed, and an installed one is marked in red with the reason (turning it off by itself comes in 5.6.0).
* **What it does not give you.** "Reviewed" means the maintainer read the commands. A reviewed pack can still be a bad idea, and a leaked signing key would let someone sign a list. You still read the allow dialog. Safe mode (`--safe-mode`) lets you see the list but blocks installs.
* **Text from the list.** Names, descriptions and tags come from the list and are shown as plain text (no links, no HTML). The author name is written by the pack itself and is labeled "self-declared"; the submitter is the GitHub account the maintainer checked.

How the maintainer publishes and handles keys: [publish.md](publish.md).

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
* **정지 유예·launch·bag (5.4.0).** `stopGrace`(3~10초, 공식 팩 3~30초)는 Ctrl-C 뒤 채널을 닫는 시점만 늦춰요. 길게 적어도 화면을 나가거나 연결이 끊기거나 앱을 닫는 정리는 그대로고, 앱을 닫을 때는 기다리지 않아요. `ros2 launch`·`ros2 bag play`는 읽기가 아니라서 앱이 `change` 이상으로 계산하고, 실행할 때마다 확인창을 거쳐요(`risk: "read"`로 적어도 소용없어요). 실제 기기에서 멈춤·화면 이동·연결 끊김·앱 강제 종료 뒤에 launch·bag 프로세스가 남지 않는 것을 확인했어요. 한계: 이 확인은 `bash -ic`와 pty 조합에서 한 것이고, launch 파일이 스스로 새 세션을 만들어(`setsid`) 띄운 프로그램은 앱이 정리하지 못해요.
* **그래프 (5.2.0).** `chart` 항목은 앱이 **읽기 전용으로 증명한** 명령만 쓸 수 있어요(팩이 `read`라고 적는 것만으로는 안 돼요). 사용자가 시작을 눌러야 돌고(`auto`는 화면을 열 때, 허용 창에 간격과 함께 보여요), 멈춤·화면 이탈·연결 끊김·앱 종료 때 멈춰요. 한 번 읽을 때마다 시간 제한이 있는 짧은 명령이라 Device에 남는 것이 없어요. 외부 팩 간격은 1초 이상, 앞 읽기가 안 끝나면 건너뛰고, 느리면 간격을 늘리고, 연속 5번 실패하면 멈춰요. 출력은 숫자만 읽고(256KB·1000줄까지), 선 이름에는 영문자·숫자·`_ . -` 20자만 출력에서 가져와요.
* **탐색기 배지와 폴더를 열 때 저절로 실행되는 것 (5.3.0).** 배지는 클릭 없이 폴더를 여는 것만으로 팩 명령이 실행되는 유일한 곳이에요(4.1.0부터 있던 내장 Git 표시도 같아요). 배지 명령은 앱이 읽기 전용임을 **팩을 읽을 때와 실행 직전(실제 폴더 이름을 채운 뒤) 두 번** 증명해야 하고, 못 하면 말없이 건너뛰어요. 허용 창의 "자동으로 돌아가는 것" 구역에 명령 전문이 "폴더를 열 때"로 보여요. 폴더 이름은 따옴표 처리한 낱말 하나로만 들어가요. **믿을 수 없는 저장소**(받은 압축 파일, 남의 clone)는 저장소 안의 설정으로 Git이 프로그램을 실행하게 만들 수 있어요. 그래서 JetDeck은 `git`을 실행하기 전에 저장소 자신의 설정을 검사하고 **프로그램을 실행할 수 있는 설정이면 Git을 실행하지 않아요**(폴더에 ⚠와 이유가 떠요). 훅·서명 확인 프로그램·페이저·인덱스 쓰기도 꺼요. 이 가드는 `git`을 쓰는 **모든** 팩 항목(버튼·미리보기·실시간 보기·그래프·`from` 목록)과 탐색기의 내장 Git 표시에도 적용돼요. 한계: 저장소마다 설치한 Git LFS처럼 저장소 로컬 필터 설정이 있으면 그것도 거부돼요(안전한 쪽). `env`·`xargs`·`find -exec`로 `git`을 실행하는 명령은 가드를 지나지 않아서 읽기로 인정되지 않고 먼저 물어요. 내 셸과 전역 Git 설정은 믿어요. 간격 3초 이상·연결당 한 번에 하나·15초 제한·연속 3번 시간 초과 시 정지·레코드 5000개·출력 1MB. 끄는 방법: 관리 창의 **탐색기 배지** 스위치, 팩 끄기, `--safe-mode`.
* **모음 (5.5.0).** 목록은 관리자의 ed25519 열쇠로 **서명**돼요(비밀 열쇠는 관리자 PC 밖으로 안 나가요). 앱은 목록을 읽기 **전에** 서명을 확인하고, 틀리면 목록을 보여 주지 않아요(저장해 둔 마지막 정상 목록만 오프라인으로 보여요). 앱이 본 가장 높은 `serial`보다 낮은 목록은 거부하고, 90일이 지나면 새 설치를 막아요. 팩 파일은 **내용 보기**를 누를 때만 받고, 크기·SHA-256이 서명된 목록과 같아야 하며 앱이 다시 검사해요. 주소 2개는 앱에 박혀 있고(HTTPS만, 리다이렉트 거부, 크기·15초 제한), 고정 `User-Agent`와 캐시 확인만 보내요(쿠키·기기 정보·설치한 팩 목록·검색어 없음). 앱을 켤 때는 아무것도 받지 않고, 모음 탭 안내에 동의한 뒤에만 받아요. 배포 앱은 주소를 바꾸는 설정을 무시해요. 철회된 팩은 설치할 수 없고, 설치된 것은 이유와 함께 빨간 줄로 알려요(자동 끄기는 5.6.0). **검토됨은 안전 보증이 아니에요.** 허용 창을 읽는 일은 그대로예요. 관리자 절차: [publish.md](publish.md).
* 우회 방법을 찾으면 공개 이슈 대신 GitHub의 "Report a vulnerability"로 알려 주세요.
