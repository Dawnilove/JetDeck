# Pack format (`format: 1`)

> English is the reference. Korean: [format.ko.md](format.ko.md). Back to [README](README.md).

A **pack** is one JSON file named `*.jdpack.json`. It holds **plugins**; each plugin holds **actions**. JetDeck runs an action's command on the Device (never on your PC) and shows the result as text or a table. A pack contains no code that runs on your PC.

Add `"$schema": "https://dawnilove.github.io/JetDeck/plugins/jdpack.schema.json"` as the first line for auto-complete in VS Code. Unknown fields are ignored (so `$comment` is fine).

## Pack

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | `a-z`, digits, `-`; starts with a letter; max 40. Reserved: `device ros2 monitor perf examples jetdeck official app core snippets`, and anything starting with `jetdeck-`. |
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
| `mode` | `exec` \| `terminal` | no | `exec` (default) runs and shows the result. `terminal` types `cmd` into the active terminal (max 20 lines). |
| `enter` | boolean | no | `terminal` only. Default `true`: press Enter after typing. |
| `sudo` | boolean | no | `exec` only. JetDeck adds `sudo`. Needs a single command (no pipes or redirects). Not allowed with `read`. |
| `confirm` | text | change/danger | Shown in the confirmation box. Max 500. |
| `preview` | string | cleanup/install | A read-only command run before the real one. Required for delete, install and cleanup actions. |
| `params` | array | no | Choices: `[{ "name", "label", "choices": [{ "value", "label" }] }]`. Max 30 choices. A `value` has no shell special characters and does not start with `-`. |
| `auto` | boolean | no | Run when the screen opens. Only when the app-computed risk is `read`. Max 5 per pack. |
| `display` | object | no | `{ "type": "text" }` or a table, see below. |
| `timeout` | number | no | Seconds. Default 60, max 600 for external packs. |
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
| Auto-run actions per pack | 5 |
| Output shown | 256 KB (ANSI codes and control characters removed, secret-looking values masked) |
| Parallel runs per pack | 3 |

## Compatibility

`format: 1` is fixed for 5.x. New 5.x versions only **add** fields. Use `minApp` when you need one of them.
