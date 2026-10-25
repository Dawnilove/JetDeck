// 젯슨 화면 뷰어: 기기 점검 결과를 읽고, VNC가 안 켜져 있을 때 보여 줄 "켜는 방법"을 만든다 (설치는 사용자가 직접)
import { tr } from './i18n.mts'
export const VNC_PORT = 5900

// 따옴표 안에서 $가 그대로 기기 셸로 가도록 작은따옴표 없이 작성. port: 연결 설정의 VNC 포트 (숫자만)
export const probeCmd = (port: number = VNC_PORT) =>
  "sh -c 'g=none; if command -v grdctl >/dev/null 2>&1; then if grdctl --help 2>&1 | grep -qi vnc; then g=vnc; else g=rdp; fi; fi; " +
  'x=no; command -v x11vnc >/dev/null 2>&1 && x=yes; ' +
  'd=$(loginctl show-user $(id -un) -p Display --value 2>/dev/null); t=none; [ -n "$d" ] && t=$(loginctl show-session $d -p Type --value 2>/dev/null); ' +
  `p=closed; ss -ltn 2>/dev/null | grep -q ":${Math.floor(Number(port)) || VNC_PORT} " && p=open; ` +
  'echo "grd=$g x11vnc=$x session=$t port=$p uid=$(id -u)"\''

export type Probe = { grd: 'vnc' | 'rdp' | 'none'; x11vnc: boolean; session: string; portOpen: boolean; uid: number }

export function parseProbe(text: string): Probe | null {
  const kv = Object.fromEntries([...text.matchAll(/(\w+)=(\S*)/g)].map((m) => [m[1], m[2]]))
  if (!kv.grd || !kv.session) return null
  return {
    grd: kv.grd === 'vnc' || kv.grd === 'rdp' ? kv.grd : 'none',
    x11vnc: kv.x11vnc === 'yes',
    session: kv.session,
    portOpen: kv.port === 'open',
    uid: Number(kv.uid) || 1000
  }
}

export type Step = { text: string; cmd: string }
export type Guide = { title: string; text: string; steps: Step[] }

export function makeGuide(p: Probe | null, port: number = VNC_PORT): Guide {
  if (!p) return { title: tr('Device를 점검하지 못했어요'), text: tr('연결 상태를 확인하고 다시 눌러 주세요.'), steps: [] }
  if (p.session === 'none')
    return { title: tr('로그인된 데스크톱이 없어요'), text: tr('Device 모니터에 로그인(바탕화면이 보이는 상태)해 두어야 화면을 볼 수 있어요. 로그인한 뒤 다시 눌러 주세요.'), steps: [] }
  if (p.portOpen)
    return { title: tr('VNC 서버는 켜져 있는데 연결하지 못했어요'), text: tr('포트 {0}이 열려 있어요. 서버가 SSH 터널(127.0.0.1)에서 오는 연결을 받는지, 다른 방식(-localhost 설정 등)인지 확인하세요.', port), steps: [] }
  // GNOME 내장 서버에 VNC가 있으면 설치 없이 켜기만 하면 됨 (Ubuntu 24.04처럼 RDP만 있는 빌드는 해당 없음)
  if (p.grd === 'vnc')
    return {
      title: tr('VNC가 꺼져 있어요'),
      text: tr('Device의 GNOME 화면 공유에 VNC가 들어 있어요. 설치 없이 켜기만 하면 돼요 (아래를 Device 터미널에서 차례로, <비밀번호>는 직접 정하세요).'),
      steps: [
        { text: tr('비밀번호 방식으로 설정'), cmd: tr("grdctl vnc set-auth-method password && grdctl vnc set-password '<비밀번호>'") },
        { text: tr('켜기'), cmd: 'grdctl vnc disable-view-only && grdctl vnc enable && systemctl --user enable --now gnome-remote-desktop' }
      ]
    }
  if (p.session === 'wayland')
    return {
      title: tr('이 화면 방식(Wayland)에서는 VNC 서버를 쓸 수 없어요'),
      text: tr('로그인 화면에서 톱니바퀴를 눌러 "Ubuntu on Xorg"(X11)를 고른 뒤 다시 로그인하면 아래 방법을 쓸 수 있어요.'),
      steps: []
    }
  const steps: Step[] = []
  if (!p.x11vnc) steps.push({ text: tr('x11vnc 설치 (Device에 한 번만, JetDeck은 설치하지 않아요)'), cmd: 'sudo apt install -y x11vnc' })
  steps.push({ text: tr('VNC 비밀번호 저장 (물으면 직접 입력)'), cmd: 'x11vnc -storepasswd' })
  steps.push({
    text: tr('켜기 (이 PC에서만 들어오게, 재부팅하면 다시 켜야 해요)'),
    cmd: `x11vnc -display :0 -auth /run/user/${p.uid}/gdm/Xauthority -rfbauth ~/.vnc/passwd -localhost -forever -shared -bg${port !== VNC_PORT ? ` -rfbport ${port}` : ''}`
  })
  return { title: tr('VNC 서버가 꺼져 있어요'), text: tr('이 Device에는 VNC 서버가 없어요. 아래 명령을 Device 터미널에서 차례로 실행한 뒤 다시 연결하세요.'), steps }
}
