# Pack permissions (6.0.0, serial 6.1.0) · 팩 권한

> Back to [README](README.md) · [format](format.md) · [security](security.md). 한국어 요약은 아래에 있어요.

Before 6.0.0 a pack could only run commands on the Device. From 6.0.0 a pack can also **ask to use app features**: list and download files (`sftp.read`), upload files (`sftp.write`), and connect one Device port to this PC (`tunnel`). From 6.1.0 it can also read a serial port of this PC (`serial.read`, read-only). The pack declares **what** and **how far**. The app keeps the pack inside that range.

**This changes the security model.** Until 5.6.0 nothing in a pack touched your PC. A pack with permissions can now write a file to your PC (a download you save), read a file from your PC (an upload you pick), and open a port on `127.0.0.1` of your PC (a tunnel). The pack never chooses the PC path, and every use needs your click. Read the permission lines in the allow dialog.

**Serial (6.1.0) is different again:** it touches a device plugged into your PC. The pack never sends anything to the device, but opening a port can restart some boards. See [Serial read](#serial-read-610).

## Declaring permissions

Needs `"minApp": "6.0.0"` (a pack with `permissions` or `mode: "app"` items and a lower `minApp` is refused). Official packs: at most 5 permissions. Other packs: at most 3.

```json
"permissions": [
  { "id": "logs", "kind": "sftp.read", "root": "~/logs", "maxBytes": 10485760,
    "why": "Download logs to this PC" },
  { "id": "inbox", "kind": "sftp.write", "root": "~/upload", "overwrite": "ask",
    "why": "Upload config files" },
  { "id": "jupyter", "kind": "tunnel", "remotePort": 8888, "maxMinutes": 30,
    "why": "Open Jupyter from this PC" }
]
```

| Field | Used by | Rule |
|---|---|---|
| `id` | all | `a-z`, digits, `-`; 2–30 characters; unique in the pack |
| `kind` | all | `sftp.read`, `sftp.write`, `tunnel` or `serial.read`. Unknown = error |
| `why` | all | text (or `{ko, en}`), up to 300 characters. Shown under the label "Pack description (author's words)" |
| `root` | sftp.* | starts with `~/`, at least one folder below the home folder, no `..`, no `//`, up to 200 characters |
| `maxBytes` | sftp.* | integer, up to 20 MB, default 5 MB |
| `overwrite` | sftp.write | `"ask"` (default) or `"never"`. There is no `"always"` |
| `remotePort` | tunnel | integer 1024–65535, not in the denied list below |
| `maxMinutes` | tunnel, serial.read | 1–60, default 10 |
| `baud` | serial.read | required; one of 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600 |

`risk` is computed by the app from the kind: `sftp.read` = read, `sftp.write`, `tunnel` and `serial.read` = change. A permission cannot be rated `danger`; a range that is too wide (outside the home folder, a sensitive folder, a denied port) makes the **pack refused** instead.

A permission that no item uses is a warning (the gallery build and the pack check fail on warnings).

## Items that use a permission: `mode: "app"`

```json
{ "id": "get", "label": "Download", "mode": "app", "perm": "logs", "op": "get",
  "path": "{file}",
  "fields": [{ "name": "file", "label": "File name", "type": "text", "charset": "free", "maxLen": 120 }] }
```

| Field | Rule |
|---|---|
| `perm` | the `id` of a permission in this pack |
| `op` | `sftp.read`: `list`, `text`, `get`. `sftp.write`: `put`. `tunnel`: `open`. `serial.read`: `read` |
| `path` | path **below `root`**, with `{name}` slots filled from `fields`. `list` may leave it empty. `open` has no `path` |
| `fields` | only `select` (fixed `choices`), `text` (`word` or `free`) and `int`. Every field must appear in `path` |
| not allowed | `cmd`, `sudo`, `auto`, `chart`, `from`, `badges`, `params`, `preview`, `confirm`, `timeout` and the other command fields. Permissions run only when a person clicks |

What each `op` does:

* `list` — shows the folder (up to 2000 entries). `text` — shows a text file (up to 256 KB, secret-looking values masked). `get` — you pick where to save it in the system save dialog.
* `put` — you pick the PC file in the system open dialog, then the app shows a confirm window (file name, size, target path, and a red line if the name exists). The file is written to a temporary name and renamed.
* `open` — the app picks a free port on `127.0.0.1`, shows a confirm window, then shows the address and the time left with a stop button.

## What the app enforces (every time, in the main process)

* The screen sends only ids and field values. It never sends a path. The PC path comes only from the system dialogs.
* The Device path is rebuilt each run: relative parts only, no `..`, no control or direction characters, links resolved on the Device (`realpath`) and checked to stay inside the resolved `root`, regular files only, size within `maxBytes`.
* A denied list applies to every permission and the pack cannot change it: system folders (`/etc`, `/proc`, `/sys`, `/dev`, `/boot`, `/root`), key and credential folders (`.ssh`, `.gnupg`, `.aws`, `.kube`, `.docker`, `.config/gcloud`, `.netrc`, `.jetdeck`), and secret-looking files (`.env*`, `*.pem`, `*.key`, `id_*`, history files). A `sftp.write` `root` cannot contain a folder that starts with a dot. Writing is also refused for shell start files, `authorized_keys`, autostart and systemd folders, and `.git`. A read `root` such as a whole `~/.config` or `~/.cache` can hold credentials under ordinary names, so the review rejects it.
* Downloads: executable and script types (`.exe .bat .cmd .ps1 .lnk .scr .msi .vbs .js .jar .com .hta` and similar) are refused as save names. The app never opens or runs a downloaded file.
* Uploads get mode `0644`. The app has no way to make an uploaded file executable.
* Tunnels: local forward only, `127.0.0.1:<remotePort>` on the Device side, no other host. Denied ports: below 1024, 22, 23, 2375, 3389, 5900–5909, 6379, 9200, 11211, 27017. The PC port is chosen by the app and changes every time. The tunnel closes after `maxMinutes`, on the stop button, when you leave or reload the screen, when the connection drops, when the pack is turned off or changed, and when the app quits. Limits: 2 tunnels per pack, 4 in the app, 32 open connections per tunnel, no auto start.
* One transfer at a time per connection, at most 10 minutes. A dropped connection cancels it and removes the temporary file.
* A confirm window is **always** shown for `put` and `open`. Its sentences are written by the app, not by the pack.

## Limits you should know (shortcuts, not bugs)

* **The denied list is name-based.** A secret file with an ordinary name inside `root` can still be downloaded. Keep `root` narrow and put only files you want to share in it.
* **A check and the use that follows are not one step.** SFTP has no way to open a file "relative to a checked folder". A person who already controls the Device (replaces a folder with a link between the check and the use) can race the check. Hard links and bind mounts are not detected.
* **An overwrite changes the file mode to `0644`.** If a file was `0600`, after an upload other accounts on the Device can read it. The mode is fixed on purpose; use `overwrite: "never"` or a new name when this matters.
* **A tunnel is open to other programs on this PC.** Any program (and any user) on this PC can connect to `127.0.0.1:<port>` while it is open. A web page in your browser may also try to reach it. Use a tunnel only for a service that has its own login, and close it when you are done.
* **A new version can widen a range** (for example `~/logs` to `~/data`) with the same permission names. The app shows a red "permissions grew or changed" line in the allow dialog. The gallery list shows only the kind (`sftp.read`), not the folder, so compare the old and new `root` and `remotePort` yourself.
* The upload rename needs the OpenSSH `posix-rename` extension on the Device. Without it, an upload over an existing file fails instead of falling back to a risky method.
* Not tested here: browser attacks on a local port (DNS rebinding), other users on the same PC, antivirus reactions, and a real Windows "downloaded from the internet" mark on saved files.

## Serial read (6.1.0)

```json
{ "id": "uart", "kind": "serial.read", "baud": 115200, "maxMinutes": 10, "maxBytes": 5242880,
  "why": "Read the boot log of a board plugged into this PC" }
```

with the item `{ "mode": "app", "perm": "uart", "op": "read" }`. Needs `"minApp": "6.1.0"` (a lower `minApp` is an error; a 6.0 app refuses the whole pack). `maxBytes` is up to 20 MB, default 5 MB.

* **Read-only by construction.** The code that opens the port has no write function, and the pack has no way to ask for one. Flow control is off. 8N1 only. `serial.write` and control-line settings do not exist.
* **You pick the port every time.** The pack cannot name a port (`port`, `path`, `device` are errors). A system dialog lists the ports of this PC and you choose one, then a confirm window written by the app shows the port, the baud rate and the limits. The app does not remember the port.
* **The app lowers DTR and RTS** after opening (Linux) and keeps the port lock, so another program using the port makes the open fail. The text shows on screen only (last 2000 lines); the pack never receives it. Secret-looking values (`password`, `secret`, `token`, `api_key`, `psk`, `pass` followed by `=` or `:`) are masked, which also masks a few harmless lines.
* **Limits:** 1 reader per pack, 2 in the app. It stops at `maxMinutes`, at `maxBytes`, on the stop button, when you leave the screen, when the connection drops, when the pack is turned off or changed, and when the app quits. The SSH connection must be open.
* **What stays open.** **Opening a port can restart some devices** (many Arduino boards, some USB-serial adapters): the open itself changes DTR, and the app cannot always prevent that, especially on Linux. **Do not open the port of a 3D printer, CNC, PLC or any machine that is working.** The gallery rejects packs for such devices. Not tested here: real hardware, Bluetooth COM ports, RS-485 adapters where a low RTS turns on the transmitter.

## Old apps

An app older than 6.1.0 refuses a pack that sets `minApp` 6.1.0 (any pack with `serial.read`). An app older than 6.0.0 refuses a pack that sets `minApp` 6.0.0 ("JetDeck 6.0.0 or newer is needed"). Settings files do not change, so going back to 5.x is safe: permission packs are refused and stay off.

## Gallery and review

The gallery index lists permissions in `caps.perms` (for example `sftp.read`, `tunnel:8888`, `serial.read:115200`). The build computes them from the pack file, `gallery:verify` compares them, and the app shows the values it computes from the downloaded file. A pack with permissions needs a **Permissions** section (20 characters or more) in the pull request. See [review.md](review.md).

An example you can copy: [examples/permissions.jdpack.json](examples/permissions.jdpack.json) and [examples/serial.jdpack.json](examples/serial.jdpack.json) (serial read).

---

## 한국어 요약

* 6.0.0부터 팩은 **앱 기능 3가지를 빌려 쓰겠다고 선언**할 수 있어요: 파일 목록·받기(`sftp.read`), 파일 올리기(`sftp.write`), Device 포트 1개를 이 PC에 연결(`tunnel`).
* **보안 모델이 달라져요.** 5.6.0까지 팩은 내 PC에 아무것도 하지 못했어요. 이제 권한이 있는 팩은 PC에 파일을 저장(받기)하고, PC 파일을 읽고(올리기), PC의 `127.0.0.1` 포트를 열 수 있어요. PC 쪽 경로는 팩이 정하지 못하고 **시스템 대화상자**에서 내가 골라요. 쓸 때마다 직접 눌러야 하고, 올리기·터널은 앱이 만든 확인 창을 거쳐요.
* `minApp "6.0.0"` 필수. 권한은 외부 팩 3개, 공식 팩 5개까지. `root`는 `~/` 아래 폴더, `remotePort`는 1024~65535(거부 포트 있음), 터널은 최대 60분.
* 항목은 `mode: "app"` + `perm` + `op`(`list`·`text`·`get`·`put`·`open`) + `path`(root 아래 상대 경로). `cmd`·`auto`·그래프·배지에는 쓸 수 없어요.
* 앱이 매번 지켜요: 경로 이탈(`..`·링크) 거부, 민감 폴더·파일 거부, 쓰기는 숨김 폴더·시작 파일 거부, 실행 파일 형식 저장 거부, 올린 파일은 `0644`, 터널은 `127.0.0.1`만·포트는 앱이 고름·시간 제한·화면을 나가면 닫힘.
* **한계**: 거부 목록은 이름 기반이에요(이름을 바꾼 비밀 파일은 못 막음). 덮어쓰면 파일 권한이 `0644`로 바뀌어요. 터널이 열려 있는 동안 이 PC의 다른 프로그램도 접속할 수 있어요. 새 버전이 같은 권한 이름으로 범위를 넓힐 수 있으니(허용 창이 빨간 줄로 알려요) 모음 목록은 종류만 보여요. 브라우저 공격(DNS rebinding)·백신 반응은 시험하지 못했어요.
* **시리얼 읽기 (6.1.0, `serial.read`)**: 이 PC의 시리얼 포트를 **읽기만** 해요(`minApp` 6.1.0 필수, `baud`는 9600~921600의 8개 중 하나). 앱의 열기 코드에 쓰기 함수가 없고, 흐름 제어는 꺼요. **포트는 팩이 못 정하고 실행할 때마다 내가 시스템 창에서 골라요.** 앱이 만든 확인 창을 거치고, 글자는 화면에만 보여요(팩은 못 받음, 비밀처럼 보이는 값은 가림). 한도: 팩당 1개·앱 전체 2개, 기본 10분·5MB(최대 60분·20MB), 정지·화면 나감·연결 끊김·앱 종료 때 닫혀요. **일부 장치(아두이노 등)는 포트를 열 때 다시 시작해요.** 작업 중인 3D 프린터·CNC·PLC의 포트는 열지 마세요(모음은 이런 팩을 거부해요). 실제 장치·블루투스 COM·RS-485 변환기는 시험하지 못했어요.
* 모음 팩은 PR에 `Permissions` 절(20자 이상)이 필요하고, 관리자가 root·포트·`why`를 이전 버전과 비교해 읽어요.
