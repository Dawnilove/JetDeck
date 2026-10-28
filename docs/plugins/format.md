# Pack format (`format: 1`)

> English is the reference. Korean: [format.ko.md](format.ko.md). Back to [README](README.md).

A **pack** is one JSON file named `*.jdpack.json`. It holds **plugins**; each plugin holds **actions**. JetDeck runs an action's command on the Device (never on your PC) and shows the result as text or a table. A pack contains no code that runs on your PC.

Add `"$schema": "https://dawnilove.github.io/JetDeck/plugins/jdpack.schema.json"` as the first line for auto-complete in VS Code. Unknown fields are ignored (so `$comment` is fine).

## Pack

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | `a-z`, digits, `-`; starts with a letter; max 40. Reserved: `device ros2 ros2-live monitor perf devtools examples jetdeck official app core snippets`, and anything starting with `jetdeck-`. |
| `format` | `1` | yes | Always `1` in 5.x. |
| `version` | string | yes | `1.2.3` (a `-suffix` is allowed). |
| `name` | text | yes | Max 60 chars. |
| `desc` | text | no | Max 300 chars. |
| `author`, `license`, `homepage` | string | no | Display only. JetDeck never opens `homepage` by itself. |
| `minApp` | string | no | Lowest JetDeck version, `1.2.3`. An older app refuses the pack. |
| `plugins` | array | yes | Max 20. May be empty `[]` when the pack has `badges`. |
| `badges` | array | no | [Explorer badges](#explorer-badges-530). Max 2 (official packs 4). Needs `minApp` 5.3.0. |

**Text** is a plain string, or `{ "ko": "…", "en": "…" }`. A missing language falls back to the other one.

## Plugin

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Unique inside the pack. |
| `title` | text | yes | Shown as the tab name. Max 60. |
| `desc` | text | no | Max 300. |
| `icon` | string | no | Reserved; lower-case word. |
| `actions` | array | yes | Max 50 per plugin, 200 per pack. |

External packs appear under the **Plugins** button of the activity bar. (Only packs shipped with the app can join an existing group.)

## Action

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Unique inside the plugin. |
| `label` | text | yes | Button name. Max 60. |
| `desc` | text | no | Max 300. |
| `cmd` | string | yes | Max 2000 chars. No control characters. `{name}` is replaced by a choice from `params`. Do not write `sudo` (use `"sudo": true`). |
| `risk` | `read` \| `change` \| `danger` | yes | What you claim. See [Risk](#risk). |
| `mode` | `exec` \| `terminal` \| `stream` | no | `exec` (default) runs and shows the result. `terminal` types `cmd` into the active terminal (max 20 lines). `stream` shows endless output live, see [below](#live-output-and-input-forms-510). |
| `enter` | boolean | no | `terminal` only. Default `true`: press Enter after typing. |
| `sudo` | boolean | no | `exec` only. JetDeck adds `sudo`. Needs a single command (no pipes or redirects). Not allowed with `read`. |
| `confirm` | text | change/danger | Shown in the confirmation box. Max 500. |
| `preview` | string | cleanup/install | A read-only command run before the real one. Required for delete, install and cleanup actions. |
| `fields` | array | no | Input form (5.1.0), see [below](#live-output-and-input-forms-510). Not together with `params`. |
| `params` | array | no | Choices: `[{ "name", "label", "choices": [{ "value", "label" }] }]`. Max 30 choices. A `value` has no shell special characters and does not start with `-`. |
| `auto` | boolean | no | Run when the screen opens. Only when the app-computed risk is `read`. Max 5 per pack. |
| `display` | object | no | `{ "type": "text" }`, a table (see below), `{ "type": "log" }` for `stream`, or `{ "type": "chart" }` ([5.2.0](#charts-520)). |
| `timeout` | number | no | Seconds. Default 60, max 600 for external packs. For `stream`: the longest run time, default 600, max 3600. |
| `stopGrace` | number | no | `stream` only ([5.4.0](#stop-grace-stopgrace-540)). Seconds to wait after Ctrl-C before the channel is closed. Default 3, 3–10 for external packs. |
| `disconnects` | boolean | no | The action ends the connection (reboot, power off). |
| `shell` | `sh` \| `bash-i` | no | `bash-i` loads `~/.bashrc` (for example ROS2). |
| `when` | `jetson` | no | Show only on a Jetson. |

An action that fails validation is dropped, and the reason is listed in the plugin manager. A value this app version does not know (a newer `mode` or `display.type`) hides the action with a "needs a newer app" note.

### Table display

```json
"display": {
  "type": "table",
  "match": "^(\\S+)\\s+(\\S+)$",
  "columns": [ "Name", "Value" ],
  "skip": 1,
  "empty": "Nothing found."
}
```

| Field | Notes |
|---|---|
| `columns` | Column headers (text each). Max 20. |
| `match` | A regular expression, one match per output line; capture groups become columns. Lines that do not match are ignored. |
| `split` | Instead of `match`: `ws` (split on white space) or `tab`. |
| `skip` | Skip this many first lines. |
| `empty` | Text shown when no row is found. |
| `labels` | Map from first-column value to a readable text. |

`match` is limited: max 200 chars, no nested quantifiers like `(a+)+`, no back-references, no lookbehind. A table shows at most 500 rows and 1000 characters per line.

## Live output and input forms (5.1.0)

Put `"minApp": "5.1.0"` in a pack that uses anything in this section. An older app then refuses the whole pack with "needs JetDeck 5.1.0 or newer".

### Live output: `mode: "stream"`

A `stream` action starts a command that does not end by itself (`journalctl -f`, `ros2 topic echo`) and shows its lines as they arrive. Use `"display": { "type": "log", "maxLines": 1000 }`. `maxLines` is how many lines stay on screen (100–5000, default 1000).

* The user presses **Start** and **Stop**. A stream never starts by itself, so `auto` is not allowed.
* **Leaving the screen, disconnecting, or closing the app stops it** on the Device too. The app sends Ctrl-C, closes the channel after 3 seconds (or `stopGrace`), and stops it when `timeout` ends.
* `timeout` is the longest run time. Default 600; external packs max 3600.
* Not allowed with a stream: `sudo`, `preview`, `auto`, and delete/install/disk commands.
* Limits: 2 running streams per pack, 4 in the whole app. A stream stops by itself when output is faster than 1 MB/s (5-second average) or passes 20 MB.
* Only a short list of endless commands counts as **read** in a stream: `journalctl -f`, `tail -f`/`-F`, `dmesg -w`, `top -b`, `iostat`, `mpstat`, `tegrastats`, `ros2 topic echo|hz|bw|delay` (safe options only; no `--filter`), `ip monitor`, `udevadm monitor`. Any other stream (`ros2 launch`, `colcon build`, …) is not read and asks first.

### Stop grace: `stopGrace` (5.4.0)

When the user stops a stream, the app first sends Ctrl-C, then waits and closes the channel (which sends SIGHUP). The wait is 3 seconds. A program that needs longer to shut down, such as `ros2 launch` with many nodes, can ask for more:

```json
{ "id": "launch-file", "mode": "stream", "cmd": "ros2 launch {file}", "risk": "change",
  "confirm": { "en": "A launch file starts programs on this Device." },
  "shell": "bash-i", "stopGrace": 10, "fields": [ ... ] }
```

* `stopGrace` is in seconds, and only `stream` actions may use it. External packs: 3–10. Official packs: 3–30.
* It only moves the moment the channel is closed. Leaving the screen, losing the connection and closing the app still clean up the Device. When the app is closed, it does not wait.
* Put `"minApp": "5.4.0"` in the pack. An older app ignores the field and waits 3 seconds.
* The official pack `ros2-live` (off by default) shows the pattern: `ros2 launch {file}` with a file list read by `find`, and `ros2 bag play` with a speed choice and a repeat flag. Both ask first.

### Input forms: `fields`

`fields` (max 6) lets the user type or pick values. Each `name` fills the `{name}` place in `cmd`. Use `fields` **or** `params`, not both.

| `type` | Extra fields | Accepted value | Goes into the command as |
|---|---|---|---|
| `select` | `choices` (fixed, like `params`) **or** `from` | `choices`: only the listed values. `from`: letters, digits and `_ . @ : ~ / + -`, max 100 | fixed: as written. `from`: one quoted word |
| `text` | `charset` (`word` default, `ros`, `free`), `maxLen` (≤200, default 60) | `word` = `A-Za-z0-9_.-`, `ros` = `A-Za-z0-9_/~`, `free` = any text without line breaks and control characters | one quoted word |
| `int` | `min` (≥0), `max` (≤1000000) | digits only, no minus sign | the number |
| `path` | `maxLen` (≤300) | absolute path starting with `/`, no `..` | one quoted word |
| `flag` | `on` (text inserted when checked, `A-Za-z0-9_.=-`) | the user only checks or unchecks | `on`, or nothing |

Common fields: `name`, `label` (text), `type`, `desc`, `default` (always a **string**, for example `"50"`; a boolean for `flag`), `required` (default `true`).

Rules the app enforces (a pack that breaks them loses the action):

* A value never starts with `-`, and never has a line break or control character.
* Write the slot as a bare word: `journalctl -u {unit} -n {lines}`. Not inside quotes (`'{unit}'`), not as the command name, not inside `$( )`, backticks, `sh -c`, or a redirect target.
* If the command needs `--` before the value, write it yourself: `grep -- {pattern} file`.
* A `sudo` action can use only fixed `select`, `int` and `flag` fields.
* **The app re-checks the filled command before every run.** A value that makes the command more risky (a path like `~/.ssh/id_rsa`) makes the app ask first and show "the value you entered raised the risk level".

#### `from`: choices read from the Device

```json
{ "name": "topic", "label": "Topic", "type": "select",
  "from": { "cmd": "ros2 topic list", "shell": "bash-i", "timeout": 15, "charset": "ros", "max": 200 } }
```

The command must be read-only, or the action is refused. It runs **by itself** when the user opens the card and on **Refresh**, so it counts toward the 5 auto-run actions per pack. Each output line is one choice; lines that do not match `charset` (`word`, `ros`, `path`) are dropped. Max 200 choices.

### Example

```json
{
  "format": 1, "id": "my-logs", "version": "1.0.0", "minApp": "5.1.0",
  "name": "My logs",
  "plugins": [{
    "id": "logs", "title": "Logs",
    "actions": [{
      "id": "follow", "label": "Follow a service log",
      "mode": "stream", "risk": "read",
      "cmd": "journalctl --no-pager -u {unit} -n {lines} -f",
      "fields": [
        { "name": "unit", "label": "Service", "type": "select",
          "choices": [ { "value": "ssh", "label": "ssh" }, { "value": "docker", "label": "docker" } ] },
        { "name": "lines", "label": "First lines", "type": "int", "min": 10, "max": 500, "default": "50" }
      ],
      "timeout": 900,
      "display": { "type": "log", "maxLines": 1000 }
    }]
  }]
}
```

## Charts (5.2.0)

Put `"minApp": "5.2.0"` in a pack that uses a chart. An older app then refuses the whole pack with "needs JetDeck 5.2.0 or newer".

A chart action runs a **read-only** command again and again and draws the numbers it reads as lines. Use `"display": { "type": "chart", ... }` on a normal `exec` action.

* The user presses **Start**, **Stop**, **Pause** and **Clear**. Data stays in the app's memory only; nothing is written to a file.
* **Leaving the screen, disconnecting, or closing the app stops it.** Every run is one short command that ends by itself, so nothing stays on the Device.
* Not allowed with a chart: `mode` other than `exec`, `fields`, `params`, `sudo`, `preview`, and a `risk` other than `read`. The app must also **prove** the command is read-only. If it cannot, the action is dropped (a warning is not enough). `auto: true` starts the chart when the screen opens; it counts toward the 5 auto-run actions per pack.
* Rules: a read waits for the one before it (it is skipped while the last one still runs); if reads are slow the interval is raised (up to 60 s); 5 failures in a row stop the chart. Limits: 5 running charts per pack, 10 in the app.

| Field | Required | Notes |
|---|---|---|
| `every` | no | Seconds between reads. Default 2. Min 1 (packs you install yourself) or 0.5 (official packs), max 60. |
| `points` | no | Points kept on screen. 10–3600, default 300. |
| `unit` | no | Unit text, max 8 characters. |
| `min` / `max` | no | Vertical range. Without them the chart picks one. |
| `match` or `split` | one of them | `match`: a regular expression applied to every output line (same limits as a table). `split`: `ws`, `tab` or `csv`; the first data line is cut into columns. |
| `skip` | no | With `split`: header lines to skip. |
| `perLine` or `series` | one of them | `perLine` (with `match`): one line on the chart per matching output line, `{ "label", "value", "scale" }`. `series` (max 8): a fixed list of lines, `[{ "label", "key" or "col", "scale" }]`. |

* `value` is the number of the `match` group that holds the number (first group = 1). `{1}` in a `perLine.label` is the first group. That text may only contain letters, digits and `_ . -` (max 20 characters); a line with other text is dropped.
* `series[].key` goes with `match`, which must then have **exactly 2 groups** (name, value). `series[].col` goes with `split` (column 1–50).
* `scale` multiplies the number (default 1). Example: `45000` with `0.001` is `45`. Only finite numbers are used; after scaling the value must be within ±1e9.
* `timeout` is the longest one read: default 10, max 30.
* If no number can be read, the card says "No readable number found" and shows the last output line, to help you fix the expression.

```json
{
  "id": "temp", "label": "Temperature chart",
  "cmd": "grep -H . /sys/class/thermal/thermal_zone*/temp 2>/dev/null || true", "risk": "read",
  "display": {
    "type": "chart", "every": 2, "unit": "C", "min": 0, "max": 100,
    "match": "thermal_zone(\\d+)/temp:(-?\\d+)$",
    "perLine": { "label": "Zone {1}", "value": 2, "scale": 0.001 }
  }
}
```

```json
{
  "id": "load", "label": "Load average chart", "cmd": "cat /proc/loadavg", "risk": "read",
  "display": {
    "type": "chart", "split": "ws", "min": 0,
    "series": [ { "label": "1 min", "col": 1 }, { "label": "5 min", "col": 2 }, { "label": "15 min", "col": 3 } ]
  }
}
```

## Explorer badges (5.3.0)

Put `"minApp": "5.3.0"` in a pack that uses badges. An older app then refuses the whole pack.

A badge puts small marks next to files and folders in the **Explorer**. When you open a folder, JetDeck runs the badge command on the Device **by itself** (no click) and reads the output. Badges are a **top-level** field of the pack (`badges`, not inside a plugin). A pack may have badges only (`"plugins": []`).

* The command must be **proven read-only by the app**, both when the pack loads and again just before each run with the real folder filled in. If the app cannot prove it, the badge is dropped (when loading) or skipped without a message (at run time; for example in `~/.ssh`).
* The only input slot is `{dir}`: the folder you opened, as an absolute path. Write it as a bare word (not inside quotes, not as the command name). JetDeck quotes it.
* Marks: at most 2 per item. Colors come from the app (`tone`), never from the pack. Hover shows the `text`. A folder gets a dot `●` when something inside it has a mark (turn off with `"folderDot": false`).
* **Off switch.** In the plugin manager each pack with badges has an **Explorer badges** switch. It stops the automatic runs and keeps the pack on. `--safe-mode` ignores external packs and their badges.
* The built-in Git marks are unchanged. When the official `devtools` pack's `git` badge is on, the Explorer skips the built-in Git call, so nothing is drawn or run twice.

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique in the pack. |
| `label` | yes | Text. Name in the manager and the allow dialog. |
| `cmd` | yes | Read-only command with exactly one `{dir}`. Max 2000 chars. |
| `shell` | no | `sh` (default) or `bash-i`. |
| `separator` | no | `line` (default) or `nul`: how output records are split. |
| `root` | no | `dir` (default): paths in the output are relative to the opened folder. `line1`: the first output line is the absolute base folder (for example a Git top folder) and the rest is relative to it. Inside a base folder JetDeck does not ask again for its sub-folders. |
| `match` | yes | Regular expression applied to each record (same limits as a table). |
| `code`, `path` | yes | Two different capture group numbers of `match`: the status code and the file path. |
| `codes` | yes | `{ "<code>": { "show", "text", "tone" } }`, 1–30 entries. A code is 1–2 characters. `show` is 1–2 visible characters. `tone` is `info`, `ok`, `warn`, `bad` or `dim`. **Only listed codes are shown.** |
| `tag` | no | `{ "match": "regex" }` with one group. The group of the first matching record (max 40 chars) is shown beside the base folder name, for example the branch. |
| `folderDot` | no | Default true. |
| `ttl` | no | Seconds before the same base folder is read again. 3–300, default 5. |
| `timeout` | no | Longest one run, 1–15 s, default 10. |

Rules at run time: one badge run at a time per connection (a newer request replaces a waiting one); results are cached for `ttl`; 3 time-outs in a row stop the badge for the rest of the connection ("stopped because it was slow"); at most 5000 records, 1 MB of output, 4096 characters per record; paths with `..` or control characters are dropped. Limits: 2 badges per pack (official packs 4).

Git repositories get one extra guard: **JetDeck does not run Git in a repository whose own settings can run programs** (the folder shows a ⚠ mark with the reason), and it turns off hooks, signature programs and pagers. See [security.md](security.md). This guard also applies to every pack item that runs `git`.

Example (the official Git status badge):

```json
{
  "id": "git",
  "label": { "ko": "Git 상태", "en": "Git status" },
  "cmd": "git --no-optional-locks -C {dir} rev-parse --show-toplevel && git --no-optional-locks -C {dir} status --porcelain=v1 -b -z --no-renames",
  "separator": "nul", "root": "line1",
  "tag": { "match": "^## (.+?)(?:\\.\\.\\.|$)" },
  "match": "^(.{2}) (.+)$", "code": 1, "path": 2,
  "codes": {
    " M": { "show": "M", "text": { "ko": "수정됨", "en": "Modified" }, "tone": "warn" },
    "??": { "show": "U", "text": { "ko": "새 파일", "en": "Untracked" }, "tone": "info" }
  }
}
```

A smaller one, without Git (marks `.py` and `.sh` files in the opened folder):

```json
{
  "id": "script-files",
  "label": "Mark script files",
  "cmd": "ls -1A {dir}",
  "match": "^(.+\\.(py|sh))$", "code": 2, "path": 1,
  "codes": { "py": { "show": "py", "text": "Python file", "tone": "info" }, "sh": { "show": "sh", "text": "Shell script", "tone": "dim" } }
}
```

## Risk

JetDeck does **not** trust the `risk` you write. It analyzes every command (all choice combinations) and uses the **higher** of the two:

* `read` — the command is proven read-only (a short allow-list of commands and options, parsed by a small shell parser). It may run without asking.
* `change` — anything it cannot prove read-only. It asks first.
* `danger` — delete, disk, power, package install/remove, send data out, `sudo`, interpreting another shell, sensitive paths. It asks first, in red.

If you write `read` but the app computes more, the action stays, the app uses the higher risk, and the dialog shows a warning. A safe rule: **write what the command really does; when unsure, write `change`.**

## Limits

| What | Limit |
|---|---|
| File size | 512 KB |
| Plugins per pack / actions per plugin / per pack | 20 / 50 / 200 |
| `cmd` | 2000 characters |
| Output shown | 256 KB (ANSI codes and control characters removed, secret-looking values masked) |
| Parallel runs per pack | 3 |
| Running streams per pack / in the app | 2 / 4 |
| Fields per action | 6 |
| Stop grace (`stopGrace`) | 3–10 s (official 3–30), default 3 |
| Stream output | stops above 1 MB/s (5 s average) or 20 MB; the screen keeps 100–5000 lines |
| Auto-run actions (`auto`, `from`, auto-start charts) | 5 per pack, counted together |
| Chart interval / points / lines | 1–60 s (official 0.5–60) / 10–3600 / 8 |
| Badges per pack / records / output / run time | 2 (official 4) / 5000 / 1 MB / 1–15 s, at least 3 s between runs of one folder |
| Chart: one read | 30 s, 256 KB and 1000 lines of output read, 5 running per pack, 10 in the app |

## Compatibility

`format: 1` is fixed for 5.x. New 5.x versions only **add** fields. Use `minApp` when you need one of them.

A 5.0.0 app that opens a 5.1 pack hides actions that use `stream`, `log` or `fields` ("needs a newer app"), or refuses the whole pack when `minApp` is higher. The same holds for a 5.1 app and a 5.2 pack with `chart`. It never runs them in a riskier way. 5.0 and 5.1 packs run unchanged in 5.2. Likewise a 5.2 app refuses a pack that sets `minApp` 5.3.0, and ignores `badges` in a pack without `minApp` (no marks, no risk). 5.0–5.2 packs run unchanged in 5.3. A 5.3 app refuses a pack that sets `minApp` 5.4.0 and ignores `stopGrace` in a pack without `minApp` (the stream stops after 3 seconds as before). 5.0–5.3 packs run unchanged in 5.4.
