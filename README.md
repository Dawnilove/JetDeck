<p align="center">
  <a href="https://dawnilove.github.io/JetDeck/"><img src="docs/banner.png" alt="JetDeck — Jetson에 특화된 SSH 작업 공간"></a>
</p>

<h3 align="center">젯슨 하나 다루는데 창 다섯 개 띄우지 마세요.</h3>

<p align="center">
  터미널 · 원격 편집 · 시스템 모니터 · ROS2 · 파일 전송 · 포트 포워딩 · 시리얼 콘솔 · MCP 연결(Claude 등)<br>
  <b>NVIDIA Jetson</b>을 위한 SSH 작업 공간. 젯슨에는 SSH 서버 말고 아무것도 설치하지 않아요.
</p>

<p align="center">
  <a href="https://dawnilove.github.io/JetDeck/"><img src="https://img.shields.io/github/v/release/Dawnilove/JetDeck?label=%EC%B5%9C%EC%8B%A0%20%EB%B2%84%EC%A0%84&color=A3E06B&labelColor=1B1F29&style=for-the-badge" alt="최신 버전"></a>
  <img src="https://img.shields.io/badge/Windows-10%20%7C%2011-2A303C?labelColor=1B1F29&style=for-the-badge" alt="Windows 10, 11">
  <img src="https://img.shields.io/badge/Linux-AppImage-2A303C?labelColor=1B1F29&style=for-the-badge" alt="Linux AppImage">
</p>

## ✨ 주요 기능

- ⌨️ **터미널** — 탭·분할, 끊기면 자동 재연결
- 📝 **원격 편집** — VS Code와 같은 Monaco 편집기, 젯슨에 서버 설치 없음
- 📊 **시스템 모니터** — CPU 코어·GPU·메모리·온도·전력 그래프, JetPack·CUDA 버전, 전원 모드 전환 (라즈베리 파이 같은 일반 리눅스도 지원)
- ▦ **분할 화면** — 연결을 최대 4개까지 한 화면에 (좌우 나열 / 바둑판), 탭을 끌어다 놓기
- 🔑 **SSH 키 마법사** — 이 PC의 키를 Device에 등록하고 비밀번호 없이 접속
- 🤖 **ROS2 도구** — 토픽 echo·hz 실시간, launch 파일 실행
- 🔧 **시리얼 콘솔** — SSH가 안 될 때의 비상구
- 📁 **파일 전송** · 🔀 **포트 포워딩** — 끌어다 놓기, Jupyter 포트 버튼 한 번
- ✳️ **MCP 연결** — Claude·Cursor·Codex 등 AI가 젯슨에서 명령 실행·파일 편집 (위험한 명령은 내가 허용해야 실행, 연결되면 버튼에 불이 켜짐)
- 🎨 **테마 17종**

<p align="center">
  <img src="docs/images/workspace.png" alt="JetDeck 작업 공간: 왼쪽 탐색기, 가운데 편집기와 터미널, 오른쪽 시스템 모니터" width="900">
</p>

<table>
  <tr>
    <td width="50%"><img src="docs/images/hosts.png" alt="연결 관리 화면"><br><sub><b>연결 관리</b> · 호스트 저장, 주변 Jetson 자동 찾기</sub></td>
    <td width="50%"><img src="docs/images/files.png" alt="파일 전송 화면"><br><sub><b>파일 전송</b> · 양쪽 목록, 끌어다 놓기</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/forward.png" alt="포트 포워딩 화면"><br><sub><b>포트 포워딩</b> · 자주 쓰는 포트 한 번에</sub></td>
    <td width="50%"><img src="docs/images/serial.png" alt="시리얼 연결 설정"><br><sub><b>시리얼 콘솔</b> · 포트와 속도만 고르면 끝</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/ros.png" alt="ROS2 화면"><br><sub><b>ROS2 도구</b> · 토픽·노드, echo·hz 실시간, launch 실행</sub></td>
    <td width="50%"></td>
  </tr>
</table>

더 많은 화면(테마 17종 등)과 자세한 사용법은 **[사이트](https://dawnilove.github.io/JetDeck/)** 에서 볼 수 있어요.

## ⬇ 다운로드

**<https://dawnilove.github.io/JetDeck/>** 에서 받으세요. 설치 방법, 사용법, 화면, 이전 버전도 모두 그곳에 있어요.

- **Windows 10 / 11** — 설치 파일 또는 포터블. "PC 보호" 창이 뜨면 **추가 정보 → 실행**
- **Linux (x64)** — AppImage, `chmod +x` 후 실행
- **젯슨 쪽 준비물** — SSH 서버만 켜져 있으면 돼요 (JetPack 기본 상태 그대로 OK)

## 🐞 문제가 있나요?

[Issues](https://github.com/Dawnilove/JetDeck/issues)에 증상과 앱 버전을 적어 주세요.

## 📄 라이선스

Copyright © 2026 Dawnilove. All rights reserved.
개인·교육 목적으로 무료로 사용할 수 있으며, 설치 파일의 수정·재배포·역설계는 허용하지 않습니다. 소스 코드는 공개하지 않습니다.
