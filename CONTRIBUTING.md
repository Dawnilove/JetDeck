# 기여하기 (Contributing)

JetDeck에 관심 가져 주셔서 고마워요. 버그 제보, 아이디어, 코드, 번역, 문서 모두 환영해요. *(English summary at the bottom.)*

## 1. Issues (버그·아이디어)
[Issues](https://github.com/Dawnilove/JetDeck/issues)에 적어 주세요.
- **버그**: 증상, 기대한 동작, 앱 버전(도움말/업데이트 내용 창), OS, 연결한 기기 종류(젯슨 모델·JetPack 등), 재현 순서
- **아이디어**: 어떤 작업이 불편한지부터 적어 주면 좋아요
- ⚠ **스크린샷·로그를 올리기 전에** 기기 이름, 사용자 이름, IP, 토큰·비밀번호가 안 보이는지 확인하세요.
- **보안 문제**(원격 실행, 비밀 유출 등)는 공개 Issue에 쓰지 말고 저장소의 *Security → Report a vulnerability*로 알려 주세요.

## 2. Pull Request
1. 큰 변경은 먼저 Issue로 이야기해요(방향이 맞는지 확인하면 헛수고를 줄여요).
2. 저장소를 Fork → 브랜치를 만들고 → 작게 나눠서 수정 → Pull Request.
3. PR 전에 로컬에서:
   ```bash
   npm run typecheck
   npm test
   node scripts/i18n-check.mjs
   ```
   (빌드·실행 방법은 [BUILDING.md](BUILDING.md))
4. PR 설명에 **무엇을·왜** 바꿨는지, 어떻게 확인했는지, **확인 못 한 것**을 적어 주세요.

### 코드 규칙
- 언어: TypeScript. 순수 로직(파싱·계산)은 `*parse.mts` + `*.test.mts`로 분리하고 테스트를 같이 넣어요.
- 화면 문구는 `tr('한국어')`로 감싸고, 영어는 `src/main/en/`에 추가해요(한국어·영어 둘 다 필요).
- Device(젯슨)에는 **아무것도 설치하지 않는다**는 원칙을 지켜 주세요(SSH로 읽고 실행만).
- 비밀(비밀번호·토큰)을 로그·파일에 남기거나 화면 밖으로 보내지 않아요. 위험한 명령은 사용자 승인을 거쳐요(`danger.mts` 참고).
- 기존 사용자 데이터(저장된 호스트 등)가 깨지지 않게 해 주세요. 앱 데이터 이름 `nanoterm`은 일부러 유지해요.
- 같은 폴더에 `foo.ts`와 `foo.mts`를 같이 두지 마세요(빌드가 실패해요).
- 테스트·샘플 데이터에는 가짜 값만 쓰세요(실제 IP·MAC·호스트·계정 이름 금지).

## 3. 라이선스와 기여물의 권리
- JetDeck의 코드는 [Apache License 2.0](LICENSE)이에요.
- 기여하면 [Apache-2.0 5조](LICENSE)에 따라, 따로 밝히지 않는 한 **기여한 내용이 같은 Apache-2.0 라이선스로 제공되는 것**에 동의한 것으로 봐요. 본인이 만든 것(또는 올릴 권리가 있는 것)만 올려 주세요. 다른 곳에서 복사한 코드는 출처와 라이선스를 PR에 적어 주세요.
- **이름 "JetDeck"·로고·마스코트는 Apache-2.0에 포함되지 않아요.** [TRADEMARKS.md](TRADEMARKS.md) 참고. 마스코트·로고 그림을 새로 기여하려면 먼저 Issue로 이야기해 주세요.
- 별도 서명(CLA)은 없어요.

## English summary
Open an Issue for bugs and ideas (remove device names, usernames, IPs and secrets from screenshots/logs; report security problems privately via GitHub's "Report a vulnerability"). For code, fork, make a small focused PR, and run `npm run typecheck`, `npm test` and `node scripts/i18n-check.mjs` first (see BUILDING.md). UI strings need both Korean `tr()` keys and English entries. By contributing you agree your contribution is provided under Apache-2.0 (section 5). The name, logo and mascots are not covered by the code license (see TRADEMARKS.md). No CLA.
