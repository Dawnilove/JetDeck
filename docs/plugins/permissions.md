# Pack permissions (6.0.0) · 팩 권한

> Back to [README](README.md) · [format](format.md) · [security](security.md). 한국어 요약은 아래에 있어요.

Before 6.0.0 a pack could only run commands on the Device. From 6.0.0 a pack can also **ask to use three app features**: list and download files (`sftp.read`), upload files (`sftp.write`), and connect one Device port to this PC (`tunnel`). The pack declares **what** and **how far**. The app keeps the pack inside that range.

**This changes the security model.** Until 5.6.0 nothing in a pack touched your PC. A pack with permissions can now write a file to your PC (a download you save), read a file from your PC (an upload you pick), and open a port on `127.0.0.1` of your PC (a tunnel). The pack never chooses the PC path, and every use needs your click. Read the permission lines in the allow dialog.

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
| `kind` | all | `sftp.read`, `sftp.write` or `tunnel`. Unknown = error |
| `why` | all | text (or `{ko, en}`), up to 300 characters. Shown under the label "Pack description (author's words)" |
| `root` | sftp.* | starts with `~/`, at least one folder below the home folder, no `..`, no `//`, up to 200 characters |
| `maxBytes` | sftp.* | integer, up to 20 MB, default 5 MB |
| `overwrite` | sftp.write | `"ask"` (default) or `"never"`. There is no `"always"` |
| `remotePort` | tunnel | integer 1024–65535, not in the denied list below |
| `maxMinutes` | tunnel | 1–60, default 10 |

`risk` is computed by the app from the kind: `sftp.read` = read, `sftp.write` and `tunnel` = change. A permission cannot be rated `danger`; a range that is too wide (outside the home folder, a sensitive folder, a denied port) makes the **pack refused** instead.

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
| `op` | `sftp.read`: `list`, `text`, `get`. `sftp.write`: `put`. `tunnel`: `open` |
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

## Old apps

An app older than 6.0.0 refuses a pack that sets `minApp` 6.0.0 ("JetDeck 6.0.0 or newer is needed"). Settings files do not change, so going back to 5.x is safe: permission packs are refused and stay off.

## Gallery and review

The gallery index lists permissions in `caps.perms` (for example `sftp.read`, `tunnel:8888`). The build computes them from the pack file, `gallery:verify` compares them, and the app shows the values it computes from the downloaded file. A pack with permissions needs a **Permissions** section (20 characters or more) in the pull request. See [review.md](review.md).

An example you can copy: [examples/permissions.jdpack.json](examples/permissions.jdpack.json).

---

## 한국어 요약

* 6.0.0부터 팩은 **앱 기능 3가지를 빌려 쓰겠다고 선언**할 수 있어요: 파일 목록·받기(`sftp.read`), 파일 올리기(`sftp.write`), Device 포트 1개를 이 PC에 연결(`tunnel`).
* **보안 모델이 달라져요.** 5.6.0까지 팩은 내 PC에 아무것도 하지 못했어요. 이제 권한이 있는 팩은 PC에 파일을 저장(받기)하고, PC 파일을 읽고(올리기), PC의 `127.0.0.1` 포트를 열 수 있어요. PC 쪽 경로는 팩이 정하지 못하고 **시스템 대화상자**에서 내가 골라요. 쓸 때마다 직접 눌러야 하고, 올리기·터널은 앱이 만든 확인 창을 거쳐요.
* `minApp "6.0.0"` 필수. 권한은 외부 팩 3개, 공식 팩 5개까지. `root`는 `~/` 아래 폴더, `remotePort`는 1024~65535(거부 포트 있음), 터널은 최대 60분.
* 항목은 `mode: "app"` + `perm` + `op`(`list`·`text`·`get`·`put`·`open`) + `path`(root 아래 상대 경로). `cmd`·`auto`·그래프·배지에는 쓸 수 없어요.
* 앱이 매번 지켜요: 경로 이탈(`..`·링크) 거부, 민감 폴더·파일 거부, 쓰기는 숨김 폴더·시작 파일 거부, 실행 파일 형식 저장 거부, 올린 파일은 `0644`, 터널은 `127.0.0.1`만·포트는 앱이 고름·시간 제한·화면을 나가면 닫힘.
* **한계**: 거부 목록은 이름 기반이에요(이름을 바꾼 비밀 파일은 못 막음). 덮어쓰면 파일 권한이 `0644`로 바뀌어요. 터널이 열려 있는 동안 이 PC의 다른 프로그램도 접속할 수 있어요. 새 버전이 같은 권한 이름으로 범위를 넓힐 수 있으니(허용 창이 빨간 줄로 알려요) 모음 목록은 종류만 보여요. 브라우저 공격(DNS rebinding)·백신 반응은 시험하지 못했어요.
* 모음 팩은 PR에 `Permissions` 절(20자 이상)이 필요하고, 관리자가 root·포트·`why`를 이전 버전과 비교해 읽어요.
