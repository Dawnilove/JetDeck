// 모음 색인 서명의 공개 열쇠 (ed25519, 32바이트를 base64로 쓴 44글자). 공개 열쇠는 비밀이 아님. 비밀 열쇠는 이 저장소 어디에도 두지 않음
// 2자리: [현재, 다음]. 열쇠를 바꿀 때는 앱을 먼저 업데이트해 "다음" 열쇠를 넣고, 나중에 서명 열쇠를 바꾼다 (docs/plugins/publish.md)
// 비어 있으면 앱은 모음의 모든 색인을 거부한다 (안전한 기본값). 열쇠는 `npm run gallery:keygen`을 사용자가 PC에서 실행해 만든 뒤 여기에 넣는다
export const GALLERY_KEYS: string[] = ['NAeGKtE/Z+JFA+HJDJhVsV9ZaizO8vI4obpnAXBHv44=']
