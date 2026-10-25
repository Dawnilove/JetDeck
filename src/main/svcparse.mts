// systemd 서비스 4.2.0: 젯슨에는 아무것도 설치하지 않고 systemctl·journalctl만 SSH로 실행. 출력 해석·명령 만들기 (Electron 없이 시험)
export type Service = { unit: string; load: string; active: string; sub: string; desc: string }
export type SvcData = { state: 'ok'; services: Service[] } | { state: 'nosystemd' } | { state: 'error'; text: string }

export const LIST_CMD = 'command -v systemctl >/dev/null || { echo __NOSYSTEMD__; exit 0; }; systemctl list-units --type=service --all --no-legend --plain --no-pager 2>&1'

export function parseServices(out: string): SvcData {
  if (out.includes('__NOSYSTEMD__')) return { state: 'nosystemd' }
  const services: Service[] = []
  const bad: string[] = []
  for (const raw of out.split('\n')) {
    const l = raw.trim()
    if (!l) continue
    const m = l.match(/^(\S+\.service)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/)
    if (m) services.push({ unit: m[1], load: m[2], active: m[3], sub: m[4], desc: m[5] })
    else bad.push(l)
  }
  if (!services.length && bad.length) return { state: 'error', text: bad.join('\n') }
  return { state: 'ok', services }
}

// 서비스 이름만 허용 (셸에 그대로 넣으므로)
export const isUnit = (v: unknown): v is string => typeof v === 'string' && v.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9:_.@-]*\.service$/.test(v)

export type SvcAction = 'start' | 'stop' | 'restart'
export const isSvcAction = (v: unknown): v is SvcAction => v === 'start' || v === 'stop' || v === 'restart'
// 비밀번호 없이(sudo -n) 먼저 시도. 끝에 종료 코드를 붙여 성공·실패를 구분함
export const actionCommand = (action: SvcAction, unit: string) => `sudo -n systemctl ${action} ${unit} 2>&1; echo __EXIT__$?`
// 비밀번호가 필요할 때 새 터미널 탭에서 사용자가 직접 입력하도록 넘기는 명령
export const termCommand = (action: SvcAction, unit: string) => `sudo systemctl ${action} ${unit}`
export const logsCommand = (unit: string, lines = 200) => `journalctl -u ${unit} -n ${Math.max(1, Math.min(2000, Math.floor(lines) || 200))} --no-pager 2>&1`
export const followCommand = (unit: string) => `journalctl -u ${unit} -n 50 -f --no-pager`

export type ActionResult = { ok: boolean; needPassword: boolean; text: string }
export function parseAction(out: string): ActionResult {
  const m = out.match(/__EXIT__(\d+)/)
  const text = out.replace(/__EXIT__\d+/, '').trim()
  const ok = m?.[1] === '0'
  return { ok, needPassword: !ok && /a password is required|no tty present|terminal is required/i.test(text), text }
}

// ssh 서버를 멈추면 이 연결이 끊김
export const isSshUnit = (unit: string) => /^(ssh|sshd)(@.*)?\.service$/.test(unit)
