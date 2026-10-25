# 이름·로고·마스코트 사용 정책 (Trademarks and Brand Assets)

JetDeck의 **코드**는 [Apache License 2.0](LICENSE)으로 누구나 쓰고 고치고 배포할 수 있어요. 하지만 아래는 **코드와 별도**로 저작권자(Dawnilove)가 권리를 가져요. Apache-2.0은 상표 사용권을 주지 않아요(6조).

## 대상
- 이름 **"JetDeck"** (앱 이름·제품 이름·저장소 이름)
- **로고·앱 아이콘**: `resources/icon.svg`·`icon.png`·`icon.ico`, `docs/icon.png`, `docs/banner.png`
- **마스코트**(모모·볼트·두두)와 그 그림: `src/renderer/src/assets/mascots/*.svg`
- 위 이미지가 들어간 공식 사이트 사진·배너

## 해도 되는 것
- 개인·교육·내부 업무용으로 이 저장소를 그대로 **빌드해서 쓰기**
- 공식 릴리스를 **수정 없이** 다시 배포(링크 공유·미러 포함). 출처(저장소 주소)를 같이 알려 주세요
- "JetDeck을 사용했다", "JetDeck과 호환된다", "JetDeck의 포크" 처럼 **사실을 설명하는 데 이름을 쓰기** (예: "JetDeck 기반 ○○")
- 기사·튜토리얼·리뷰에서 화면과 로고 사진 인용

## 하면 안 되는 것
- **수정한 버전(포크)을 "JetDeck"이라는 이름이나 비슷한 이름·같은 로고로 배포**해서 공식인 것처럼 보이게 하기
- 포크를 배포하면서 공식 로고·마스코트를 그대로 쓰기 → 포크는 **이름을 바꾸고, 로고·아이콘·마스코트 그림을 제거하거나 직접 만든 것으로 교체**해 주세요 (코드는 그대로 써도 돼요)
- 마스코트·로고를 상품, 광고, 다른 서비스의 얼굴로 쓰기
- 공식 자동 업데이트 주소(`Dawnilove/JetDeck`)를 가리키는 채로 수정판을 배포하기 (`package.json`의 `build.publish`를 바꿔 주세요)

## 이미지 사용 조건 (코드와 별도)
위 "대상"의 이미지·그림은 Apache-2.0이 아니에요. 마스코트와 로고는 AI 도구를 사용해 제작했어요. 그래서 이 그림들에 대한 권리 범위를 이 문서가 단정하지는 않아요 — 허용 범위는 아래 조건대로 안내해요. 저작권자가 허락한 범위는 (1) 이 저장소를 수정 없이 빌드·실행, (2) 수정 없이 공식 JetDeck의 일부로 재배포, (3) 위 "해도 되는 것"입니다. 그 밖(수정·별도 사용)은 먼저 허락을 받아 주세요.

## 문의
Issues에 `brand` 라고 적어 주시면 돼요. 사용 범위를 정확히 모르겠으면 먼저 물어봐 주세요.

---
*English summary:* JetDeck's code is Apache-2.0. The name "JetDeck", the logo/icon, and the mascots (Momo, Volt, Dudu) are not covered by that license. You may build and use this repository, redistribute unmodified official releases, and use the name to describe facts ("based on JetDeck"). If you distribute a modified fork, give it a different name and replace the logo, icon and mascot artwork, and point auto-update to your own releases.
