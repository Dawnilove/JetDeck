# Pack format (`format: 1`)

> English is the reference. Korean: [format.ko.md](format.ko.md). Back to [README](README.md).

A **pack** is one JSON file named `*.jdpack.json`. It holds **plugins**; each plugin holds **actions**. JetDeck runs an action's command on the Device (never on your PC) and shows the result as text or a table. A pack contains no code that runs on your PC.

Add `"$schema": "https://dawnilove.github.io/JetDeck/plugins/jdpack.schema.json"` as the first line for auto-complete in VS Code. Unknown fields are ignored (so `$comment` is fine).

## Pack

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | `a-z`, digits, `-`; starts with a letter; max 40. Reserved: `device ros2 ros2-live monitor perf examples jetdeck official app core snippets`, and anything starting with `jetdeck-`. |
| `format` | `1` | yes | Always `1` in 5.x. |
| `version` | string | yes | `1.2.3` (a `-suffix` is allowed). |
| `name` | text | yes | Max 60 chars. |
| `desc` | text | no | Max 300 chars. |
| `author`, `license`, `homepage` | string | no | Display only. JetDeck never opens `homepage` by itself. |
| `minApp` | string | no | Lowest JetDeck version, `1.2.3`. An older app refuses the pack. |
| `plugins` | array | yes | Max 20. |

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
| `display` | object | no | `{ "type": "text" }`, a table (see below), or `{ "type": "log" }` for `stream`. |
| `timeout` | number | no | Seconds. Default 60, max 600 for external packs. For `stream`: the longest run time, default 600, max 3600. |
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
* **Leaving the screen, disconnecting, or closing the app stops it** on the Device too. The app sends Ctrl-C, closes the channel after 3 seconds, and stops it when `timeout` ends.
* `timeout` is the longest run time. Default 600; external packs max 3600.
* Not allowed with a stream: `sudo`, `preview`, `auto`, and delete/install/disk commands.
* Limits: 2 running streams per pack, 4 in the whole app. A stream stops by itself when output is faster than 1 MB/s (5-second average) or passes 20 MB.
* Only a short list of endless commands counts as **read** in a stream: `journalctl -f`, `tail -f`/`-F`, `dmesg -w`, `top -b`, `iostat`, `mpstat`, `tegrastats`, `ros2 topic echo|hz|bw|delay` (safe options only; no `--filter`), `ip monitor`, `udevadm monitor`. Any other stream (`ros2 launch`, `colcon build`, …) is not read and asks first.

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
| Stream output | stops above 1 MB/s (5 s average) or 20 MB; the screen keeps 100–5000 lines |
| Auto-run actions (`auto` and `from`) | 5 per pack, counted together |

## Compatibility

`format: 1` is fixed for 5.x. New 5.x versions only **add** fields. Use `minApp` when you need one of them.

A 5.0.0 app that opens a 5.1 pack hides actions that use `stream`, `log` or `fields` ("needs a newer app"), or refuses the whole pack when `minApp` is higher. It never runs them in a riskier way.
