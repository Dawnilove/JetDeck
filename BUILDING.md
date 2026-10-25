# 빌드하기 (Building)

JetDeck은 Electron + React + TypeScript 앱이에요. 다른 PC에서 받아서 실행·빌드하는 방법입니다. *(English summary at the bottom.)*

## 준비물
| 항목 | 버전 | 비고 |
|---|---|---|
| Node.js | **24** (npm 11) | CI도 24 기준 |
| Git | 아무 최신 | |
| OS | Windows 10/11 · Linux (x64, arm64) | macOS는 지원·확인하지 않았어요 |
| (Linux 빌드만) xvfb | `sudo apt install xvfb` | main을 V8 바이트코드로 만들 때 Electron이 잠깐 떠서 가상 화면이 필요 |

> 젯슨(Device) 쪽에는 아무것도 설치할 필요가 없어요. 이 문서는 **앱을 개발하는 PC** 기준입니다.

## 1. 받아서 실행
```bash
git clone https://github.com/Dawnilove/JetDeck.git
cd JetDeck
npm ci
node node_modules/electron/install.js   # npm 11은 설치 스크립트를 안 돌려서 Electron 실행 파일을 직접 받아야 해요
npm run dev                              # 개발 모드로 앱이 떠요
```
- `Error: Electron uninstall`이 나오면 위 `install.js` 단계를 빠뜨린 거예요.
- Windows PowerShell에서는 `&&` 대신 줄을 나눠 실행하세요(PowerShell 5.1은 `&&` 없음).

## 2. 검사
```bash
npm run typecheck                 # 타입 검사
npm test                          # 단위 테스트 (node --test)
node scripts/i18n-check.mjs       # 화면 문구 번역 사전 검사
```
화면 문구는 `tr('한국어 문장')`으로 감싸고 영어는 `src/main/en/*.mts`에 있어요. 새 문구를 넣으면 `i18n-check`가 통과해야 해요.

## 3. 설치 파일 만들기 (결과는 `release/`)
| 만들 것 | 명령 | 비고 |
|---|---|---|
| Windows 설치 파일 + 포터블 | `npm run dist` | Windows PC에서 |
| Linux x64 AppImage | `npm run dist:linux` | Linux x64 PC에서, `xvfb-run -a npm run dist:linux` |
| Linux arm64 AppImage (젯슨 등) | `npm run dist:linux:arm64` | **arm64 기기에서 직접** (main 바이트코드가 CPU에 맞아야 해서 교차 빌드 안 됨) |
- `npm run dist*`는 먼저 `npm run licenses`를 돌려 제3자 라이선스 모음(`build/THIRD_PARTY_LICENSES.txt`)을 만들고, 설치 파일의 `resources/` 폴더에 같이 넣어요.
- Windows 설치 파일은 코드 서명이 없어서 "PC 보호" 창이 뜰 수 있어요(추가 정보 → 실행).
- 이 저장소의 GitHub Actions(`.github/workflows/linux.yml`)가 같은 방식으로 Linux x64·arm64를 만들어요.
- 만든 설치 파일은 공식 JetDeck 릴리스가 **아니에요**. 배포할 때는 [TRADEMARKS.md](TRADEMARKS.md)를 읽어 주세요.

## 4. 폴더 안내
```
src/main       Electron main (SSH·SFTP·시리얼·MCP·모니터 등, 순수 로직은 *parse.mts + *.test.mts)
src/preload    화면↔main 다리(IPC)
src/renderer   React 화면
themes/        테마 JSON (사용자가 폴더에 추가도 가능)
resources/     아이콘·MCP 브리지 스크립트
scripts/       아이콘 생성(make-icon.cjs)·배너·i18n 검사
docs/          사이트(GitHub Pages)·릴리스 노트
```

## 알아 둘 것
- 같은 폴더에 `foo.ts`와 `foo.mts`를 같이 두지 마세요 — 타입 검사는 통과해도 **빌드가 실패**해요(그래서 순수 로직 파일은 `fooparse.mts`처럼 이름을 다르게 써요).
- 앱 데이터 폴더(`%APPDATA%\nanoterm`)·패키지 이름 `nanoterm`은 옛 이름이지만 기존 사용자의 저장된 호스트가 깨지지 않도록 **일부러 그대로** 둔 거예요.
- 앱 화면 시험은 가짜 SSH 서버 + `npx electron . --remote-debugging-port=9555 --user-data-dir=<임시폴더>`로 CDP에 붙이는 방식을 썼어요(별도 `--user-data-dir`을 꼭 쓰세요, 내 호스트 정보가 섞이지 않게).
- 진짜 기기 없이도 `npm test`와 앱 실행(연결 화면·테마·설정)은 확인할 수 있어요. SSH 기능은 SSH 서버가 있는 기기(젯슨·라즈베리파이·Linux)가 필요해요.

## English summary
Requirements: Node.js 24 (npm 11), Git, Windows 10/11 or Linux (x64/arm64); `xvfb` for Linux builds. Clone, run `npm ci`, then `node node_modules/electron/install.js` (npm 11 skips install scripts), then `npm run dev`. Checks: `npm run typecheck`, `npm test`, `node scripts/i18n-check.mjs`. Installers: `npm run dist` (Windows), `npm run dist:linux`, `npm run dist:linux:arm64` (build on arm64). Output goes to `release/`. Do not keep `foo.ts` and `foo.mts` in the same folder (the build fails). The `nanoterm` names are legacy and kept for data compatibility.
