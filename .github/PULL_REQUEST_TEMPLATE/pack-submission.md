<!-- Use this form for a pack submission: open the PR with ?template=pack-submission.md -->
## Pack
<!-- id and version, for example: sensor-check v1.0.0 -->

## What does it do?
<!-- One or two sentences. 한두 문장으로 무엇을 하는지 적어 주세요. -->

## Danger items
<!-- Only if the pack has items rated "danger": say why each one is needed (at least 20 characters). The CI check fails without it. -->

## Checks
- [ ] I added **one** file: `docs/packs/files/<id>/<version>/<id>.jdpack.json` (nothing else under `docs/packs/`)
- [ ] I read every command. None sends data out, runs downloaded code, or touches passwords, keys or private files without a clear reason
- [ ] The description and confirm texts match what the commands really do
- [ ] The pack has `license`, `author`, `desc` and `version`, and the licence allows redistribution
- [ ] No secrets, personal data, real IP addresses or device names
- [ ] I understand that merging does not publish the pack: the maintainer signs a new list separately, and "reviewed" is not a promise of safety
