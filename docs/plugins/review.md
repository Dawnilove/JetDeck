# Reviewing a submitted pack · 팩 심사 기준

> For the maintainer and for people who want to know what "reviewed" means. 한국어는 아래에 있어요. Back to [README](README.md) · [publishing](publish.md).

"**Reviewed**" means one thing: the maintainer **read every command** of the pack and found nothing wrong. It is **not a promise that the pack is safe.** The app shows the same sentence next to every gallery pack, and you still read the allow dialog yourself.

## What the automatic check does

Every pull request that touches `docs/packs/` runs the **Pack check** (`.github/workflows/packs.yml`). It only reads the JSON. It never runs the pack. It uses the same validator as the app and fails when:

* the path is not `docs/packs/files/<id>/<version>/<id>.jdpack.json`, the id is not 3–40 characters of `a-z`, digits and `-`, or the id or version inside the file differs from the folder;
* a file that is already published is changed or deleted (a published version never changes: add a new version folder);
* the PR adds more than one pack;
* the id is an official or reserved id, starts with `jetdeck-`, or is **one letter away** from an official id or a pack already in the gallery;
* the validator reports any error or warning, an item is rated **lower** than the app computes, or an item is of a kind this app cannot read;
* `license`, `author`, `desc` or `version` is missing;
* the file is larger than 128 KB, is not JSON, or contains control, bidirectional or invisible characters;
* the pack has `danger` items and the PR description has no "Danger" section that explains them (at least 20 characters);
* the pack has permissions and the PR description has no "Permissions" section that explains them (at least 20 characters), has more than 3 permissions, or sets `minApp` lower than 6.0.0 (6.1.0 when it uses `serial.read`).

The result and every command are written to the **Job summary** of the run. (Pull requests from forks cannot write comments, and the check uses no secrets and never `pull_request_target`.)

A green check means "the file is well-formed". **It says nothing about whether the commands are a good idea.**

## What the maintainer reads

Open the Job summary and the file, then check each point. Merging a pull request does **not** publish the pack: it only lands the file. The list is signed and pushed separately ([publish.md](publish.md)).

1. **Every command was read.** No `curl`, `wget`, `ssh`, `scp`, `nc`, `base64`, `eval`, `sh -c`, `bash -c`, `sudo`, `rm`, `dd`, `mkfs`, `>` redirect or sensitive path (`~/.ssh`, `/etc/shadow`, tokens, history) — or the reason is clear and the confirm text says so.
2. **What runs on its own is read-only and light.** Charts, badges, `from` lists and `auto` items run without a click. Check their interval and that they only read.
3. **Texts match the commands.** Names, descriptions and confirm texts do not mislead. No "paste this line in a terminal" advice, no links, no hidden text.
4. **Licence and data.** The licence allows redistribution. No secrets, personal data, real IP addresses or device names.
5. **No imitation.** The name and id do not copy another pack, an official pack or a person.
6. **Danger items** are needed, rated honestly, and have a confirm text and (for removals) a preview.
7. **Permissions** (6.0.0): `root` is narrow and holds only files meant to be shared (not a whole `~/.config`, `~/.cache` or data folder); no name that looks like a secret; the write target is not a start file; the tunnel port really matches the service named in `why`; `why` matches what the items do; the item cannot do its job without a permission.
8. **Serial** (6.1.0): serial is really needed (the built-in console is not enough); the baud rate matches the device named in `desc` and `why`; `why` does not push people to a particular port; the pack is **not for a 3D printer, CNC, PLC or similar machine — reject such packs**; compare baud and limits with the old version.
9. **Updates:** compare with the previous version (`git diff` between the two version folders). Look hardest at what changed, **and compare `root` and `remotePort` with the old version**: the gallery list shows only the permission kind, so a widened folder with the same name is not visible there.

If you are not sure, ask the author or say no. Saying no is cheap; withdrawing a pack is not.

## After the merge

Add a line to `docs/packs/catalog.json` (`submitter` = the GitHub account of the PR author, `reviewedAt` = the day you read it), then `npm run gallery:build`, read the summary, sign, verify and push. See [publish.md](publish.md).

---

## 한국어

"**검토됨**"은 관리자가 팩의 **모든 명령을 읽었고 문제를 못 찾았다**는 뜻이에요. **안전하다는 보증이 아니에요.** 앱도 모음의 모든 팩 옆에 같은 문장을 보여 줘요. 허용 창은 계속 직접 읽어야 해요.

**자동 검사** (`docs/packs/`를 건드리는 PR마다 `Pack check`가 돌아요. JSON을 읽기만 하고 팩을 실행하지 않아요. 앱과 같은 검증기를 써요): 경로·id·버전 모양, 이미 올린 파일 수정·삭제, PR 하나에 팩 하나, 공식·예약 id·`jetdeck-` 접두·**한 글자 차이** id, 검증기 오류·경고, 앱 계산보다 **낮게 적은** 위험도, 앱이 모르는 항목, `license`·`author`·`desc`·`version` 누락, 128KB 초과, 제어·BiDi·보이지 않는 글자, 위험 항목이 있는데 PR 설명 "Danger" 절에 이유(20자 이상)가 없는 경우, 권한이 있는데 "Permissions" 절이 없거나 권한이 3개를 넘거나 `minApp`이 6.0.0(`serial.read`는 6.1.0)보다 낮은 경우. 결과와 명령 전문은 실행 요약(Job summary)에 나와요(포크 PR은 댓글을 쓸 수 없고, 비밀값이나 `pull_request_target`은 쓰지 않아요). 초록 표시는 "파일 모양이 맞다"는 뜻일 뿐이에요.

**관리자가 읽는 것**: ① 모든 명령(`curl`·`wget`·`ssh`·`base64`·`eval`·`sh -c`·`sudo`·`rm`·`>`·민감 경로가 없거나 이유가 분명) ② 저절로 도는 것(그래프·배지·`from`·`auto`)은 읽기이고 가벼움 ③ 설명·확인 문구가 실제 명령과 맞음(속이는 글·"터미널에 붙여 넣으세요" 안내 없음) ④ 라이선스·비밀·개인정보 ⑤ 다른 팩·공식 팩·사람을 흉내 내지 않음 ⑥ 위험 항목은 꼭 필요하고 확인 문구(삭제는 미리보기)가 있음 ⑦ 권한: `root`가 좁은가(`~/.config`·`~/.cache` 통째는 안 됨), 비밀처럼 보이는 이름이 없는가, 터널 포트가 `why`의 서비스와 맞는가 ⑧ 시리얼(6.1.0): 정말 필요한가(내장 콘솔로 안 되는가), 보율이 설명한 장치와 맞는가, `why`가 특정 포트를 고르라고 유도하지 않는가, **3D 프린터·PLC·CNC 같은 장치 대상 팩은 거부**, 이전 버전과 보율·한도 비교 ⑨ 업데이트는 이전 버전과 비교해 바뀐 곳을 가장 꼼꼼히, 특히 `root`·`remotePort`(모음 목록은 권한 종류만 보여요). 확신이 없으면 묻거나 거절하세요.

**합친 뒤**: PR을 합쳐도 모음에는 안 보여요. `catalog.json`에 한 줄(`submitter`=PR 작성자, `reviewedAt`=읽은 날) → `gallery:build` → 요약 읽기 → 서명 → verify → push ([publish.md](publish.md)).
