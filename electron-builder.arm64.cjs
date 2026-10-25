// Linux arm64(Jetson 등) 전용 빌드 설정: package.json의 build 설정을 그대로 쓰되 시리얼 prebuild는 linux-arm64만 넣음
// 사용: npm run dist:linux:arm64 (arm64 기기/서버에서 실행해야 main 바이트코드가 그 CPU에 맞게 컴파일됨)
const base = require('./package.json').build
const OTHERS = 'android-arm,android-arm64,darwin-x64+arm64,linux-arm,linux-x64,win32-arm64,win32-ia32,win32-x64'

module.exports = {
  ...base,
  files: base.files.map((f) => (f.startsWith('!node_modules/@serialport/bindings-cpp/prebuilds/') ? `!node_modules/@serialport/bindings-cpp/prebuilds/{${OTHERS}}/**` : f)),
  linux: { ...base.linux, target: [{ target: 'AppImage', arch: ['arm64'] }], artifactName: 'JetDeck-${version}-arm64.${ext}' }
}
