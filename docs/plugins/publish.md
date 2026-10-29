# Publishing to the gallery · 모음 게시 절차

> For the maintainer. 한국어 요약은 아래에 있어요. Back to [README](README.md).

The **gallery** is a signed list of packs at `docs/packs/`. JetDeck 5.5.0 shows it in **Plugin manager → Gallery**. Anyone can read the files; only the maintainer can sign a new list.

```
docs/packs/
  catalog.json          what to publish (written by hand)
  index.json            the list the app reads (generated, then signed)
  index.json.sig        the signature of index.json (ed25519, base64)
  index.html            the list for humans (generated)
  index.schema.json     reference schema of index.json
  files/<id>/<version>/<id>.jdpack.json   pack files
```

Rules that keep the list safe:

* **A published version never changes.** To fix a pack, add a new version folder and point `catalog.json` at it. `gallery:build` refuses a changed file.
* **One version per pack id** is listed. Old version folders stay in place.
* **`.gitattributes` keeps `docs/packs/**` byte-exact** (`-text`). A line-ending change would break the fingerprints and the signature. Do not remove it.
* The list is signed with a **secret key that only the maintainer holds**. The app has the matching **public key** built in (`src/main/gallerykeys.mts`, two slots: current and next).

## Add or update a pack

1. Put the pack file at `docs/packs/files/<id>/<version>/<id>.jdpack.json`. A gallery id has 3–40 characters (`a-z`, digits, `-`). The pack needs `license` and `desc`, and must pass the app's validator with **no errors and no warnings** (no items rated lower than the app computes, no items the app cannot read).
2. Add one line to `catalog.json`: `{ "id", "version", "submitter", "reviewedAt", "tags": [] }`. `submitter` is the GitHub account that sent the pack, `reviewedAt` the day you read the commands.
3. Read every command of the pack yourself. "Reviewed" means only that you read them. It is not a promise of safety.
4. Build the list: `npm run gallery:build`. It raises `serial`, sets `expires` (1 year), writes `index.json` and `index.html`, deletes the old signature and prints what changed. **Read that summary.**
5. Sign it **on your own PC**: `npm run gallery:sign -- --key <path to your secret key file>`. Nobody else needs the key file, and no tool or session should read it.
6. Check: `npm run gallery:verify`. It checks the signature with the public key built into the app, every file fingerprint and size, and the validator.
7. Commit `docs/packs/` and push. GitHub Pages serves it at `https://dawnilove.github.io/JetDeck/packs/`.
8. Open the gallery in a clean app (new user-data folder) and install one pack to confirm.

## Re-sign before the list expires

A list is valid for **1 year** from the day you build it. After that the app still shows it but blocks new installs (packs already installed keep working). Run `gallery:build` again once a year (no pack change is needed; `serial` goes up), then sign, verify and push. `gallery:verify` warns when fewer than 14 days are left. If you forget, new installs stop for every user until you re-sign. An old signed list stays valid until it expires or you publish a higher `serial`, so withdraw a pack by publishing a new list rather than by deleting files.

## Withdraw a pack

Add an entry to `revoked` in `catalog.json`:

```json
{ "id": "some-pack", "version": "1.0.0", "reason": { "ko": "이유", "en": "reason" }, "at": "2026-11-01" }
```

Leave out `version` to withdraw every version of the id (`sha256` can narrow it to one file). Then build, sign, verify and push. In 5.5.0 the app blocks a withdrawn pack from being installed and marks an installed one in red; turning it off automatically comes in 5.6.0.

## Keys

* **Create** a key pair on your own PC: `npm run gallery:keygen -- --out <folder outside the repository>`. It prints the public key (44 characters, not secret). Put the public key into `src/main/gallerykeys.mts` and ship an app version with it. **Until then the app rejects every list.**
* **Keep the secret key offline** (a password manager or a USB stick) and keep a separate backup. Never put it in the repository, in CI secrets, in notes or in chat.
* **If you lose the key:** you can no longer publish. Create a new pair, ship an app update that contains the new public key, then sign with the new key. Users on old app versions keep seeing the last list they saved.
* **If the key leaks:** stop publishing with it. Ship an app update with a new public key in the **next** slot and drop the old one, then sign with the new key. Tell users to update. Until they update, anyone with the old key could sign a list that old apps accept, so say so in the release notes.
* **Rotation:** ship the app with the new public key in the *next* slot first, and switch the signing key later.

---

## 한국어 요약

* 모음은 `docs/packs/`의 **서명된 목록**이에요. 앱은 목록의 서명과 파일 지문을 확인한 뒤에만 보여 줘요. 서명은 관리자만 할 수 있어요.
* **올린 버전은 고치지 않아요.** 고칠 때는 새 버전 폴더를 쓰고 `catalog.json`을 바꿔요. 팩 id마다 한 버전만 목록에 올라가요.
* `.gitattributes`의 `docs/packs/** -text`를 지우지 마세요. 줄 끝이 바뀌면 지문과 서명이 틀려져요.
* 절차: ① 팩 파일을 넣고 ② `catalog.json`에 한 줄 추가 ③ 명령을 직접 읽기 ④ `npm run gallery:build`(요약 읽기) ⑤ **내 PC에서** `npm run gallery:sign -- --key <비밀 열쇠 파일>` ⑥ `npm run gallery:verify` ⑦ 커밋·push ⑧ 깨끗한 앱에서 설치 확인.
* 목록은 만든 날부터 **1년** 뒤 만료돼요. 만료되면 목록은 보이지만 새 설치가 막혀요(이미 설치한 팩은 계속 동작). 1년에 한 번 build → 서명 → verify → push 하세요(`verify`가 14일 전부터 경고해요). 잊으면 재서명할 때까지 모든 사용자의 새 설치가 막혀요. 옛 서명 목록은 만료되거나 더 높은 `serial`이 나올 때까지 유효해요. 팩을 내릴 때는 파일을 지우지 말고 새 목록을 게시하세요.
* 철회: `catalog.json`의 `revoked`에 `id`(필요하면 `version`)와 이유를 적고 build·서명·push 해요. 5.5.0 앱은 설치를 막고 설치된 것을 빨간 줄로 알려요. 자동으로 끄는 것은 5.6.0이에요.
* 열쇠: 비밀 열쇠는 오프라인에 보관하고 백업을 따로 둬요. 저장소·CI·노트·채팅에 두지 않아요. **잃으면** 새 열쇠 쌍을 만들고 공개 열쇠가 든 앱 업데이트를 낸 뒤 서명해요. **유출되면** 그 열쇠로 게시를 멈추고, 새 공개 열쇠를 넣은 앱 업데이트를 내요. 앱을 업데이트하기 전 사용자는 옛 열쇠로 서명된 목록을 믿을 수 있으니 릴리스 노트에 적어요. 공개 열쇠가 앱에 들어가기 전에는 앱이 모든 목록을 거부해요.
