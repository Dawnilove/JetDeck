# 보안 정책 (Security Policy)

JetDeck은 SSH로 기기에 연결하고, AI 도구(MCP)가 기기에서 명령을 실행하도록 연결할 수 있는 앱이라 보안 제보를 중요하게 생각해요.

## 취약점 제보
**공개 Issue에 올리지 마세요.** 대신 이 저장소의 **Security → Report a vulnerability**(비공개 제보)를 써 주세요.
- 무엇이 문제인지, 재현 순서, 영향(예: 원격 실행, 비밀 유출, 승인 우회), 앱 버전·OS
- 실제 비밀번호·키·토큰은 적지 마세요

## 대상
- 앱 코드(SSH·SFTP·시리얼·MCP 연결·AI 터미널 읽기·설정 내보내기 등)
- 의존성의 알려진 취약점이 앱에 영향을 주는 경우

## 처리
- 확인하면 답을 드리고, 고친 버전을 낸 뒤 공개해요. 개인이 운영해서 응답에 며칠 걸릴 수 있어요.
- 지원하는 버전: **최신 릴리스**(자동 업데이트로 받을 수 있어요)

*English:* Please do not open a public issue for vulnerabilities. Use GitHub's "Report a vulnerability" (Security tab). Only the latest release is supported.
