import { ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { Client, utils, type ConnectConfig } from 'ssh2'
import { check, fingerprint, keyType, knownName, preferredAlgorithms, revoked, trust } from './hostkey'
import { clean, getHost, getPassword, type Host } from './store'

export type HostKeyInfo = {
  id: string
  variant: 'first' | 'changed'
  host: string
  keyType: string
  fingerprint: string
  oldFingerprint?: string
}
type Answer = 'cancel' | 'once' | 'trust' | 'replace'

const WIN_AGENT = '\\\\.\\pipe\\openssh-ssh-agent'
// existsSync는 named pipe를 못 찾음 → 파이프 목록에서 확인. 없는 agent를 지정하면 ssh2가 error를 내므로 미리 걸러냄
function winAgentRunning(): boolean {
  try {
    return readdirSync('\\\\.\\pipe\\').includes('openssh-ssh-agent')
  } catch {
    return false
  }
}

// 화면에 호스트 키 다이얼로그를 띄우고 사용자의 답을 기다림
const pending = new Map<string, (a: Answer) => void>()
function ask(wc: WebContents, info: Omit<HostKeyInfo, 'id'>): Promise<Answer> {
  return new Promise((resolve) => {
    const id = randomUUID()
    pending.set(id, resolve)
    wc.send('hostkey:ask', { id, ...info })
  })
}

// 화면이 새로 불러와지면 떠 있던 호스트 키 질문은 답할 곳이 없어짐 → 취소로 끝냄
export function cancelHostKeys(): void {
  for (const resolve of pending.values()) resolve('cancel')
  pending.clear()
}

const typeLabel =(t: string) => (t.includes('ed25519') ? 'ED25519' : t.startsWith('ecdsa') ? 'ECDSA' : t.includes('rsa') ? 'RSA' : t)

import { ensureLocalKey, INSTALL_KEY_CMD } from './sshkey'
import { tr } from './i18n.mts'

function friendly(e: Error & { code?: string; level?: string }): string {
  if (e.level === 'client-authentication') return tr('인증 실패: 사용자 이름과 비밀번호/키를 확인하세요')
  if (e.code === 'ENOTFOUND') return tr('호스트를 찾을 수 없어요')
  if (e.code === 'ECONNREFUSED') return tr('SSH 포트가 닫혀 있어요')
  if (e.code === 'ETIMEDOUT' || /timed out/i.test(e.message)) return tr('응답이 없어요. 주소와 네트워크를 확인하세요')
  if (/passphrase/i.test(e.message)) return tr('암호가 걸린 키는 아직 지원하지 않아요')
  return e.message
}

export function connect(wc: WebContents, raw: Host, password?: string): Promise<{ client: Client; hostKeyType: string }> {
  const h = clean(raw)
  const name = knownName(h.host, h.port)
  const prefer = preferredAlgorithms(name)
  const cfg: ConnectConfig = {
    host: h.host,
    port: h.port,
    username: h.username,
    readyTimeout: 120_000, // 사용자가 호스트 키 다이얼로그를 읽는 시간까지 포함되므로 넉넉히
    keepaliveInterval: h.keepalive ? 15_000 : 0,
    ...(prefer.length && { algorithms: { serverHostKey: { prepend: prefer } } as ConnectConfig['algorithms'] })
  }

  let allowed: string[] | undefined // 서버가 허용한 로그인 방식 (인증 실패 문구용)
  if (h.auth === 'password') {
    // 저장된 비밀번호는 저장할 때와 같은 서버·계정에만 보냄 (주소를 바꾸고 '연결 테스트'해도 다른 서버로 새지 않게)
    const saved = getHost(h.id)
    const same = saved && saved.host === h.host && saved.port === h.port && saved.username === h.username
    const pw = password || (same ? getPassword(h.id) : undefined)
    if (!pw) throw new Error(tr('비밀번호를 입력하세요'))
    // 비밀번호 → (서버가 허용하면) keyboard-interactive 순서로 시도. PAM만 켜 둔 서버도 비밀번호로 들어갈 수 있게
    // 서버가 알려 준 허용 방식을 기억해 두고, 비밀번호 로그인을 막아 둔 서버면 그렇다고 알려 줌 (아래 reject)
    let step = 0
    cfg.authHandler = (methodsLeft, _partial, next) => {
      if (methodsLeft?.length) allowed = [...new Set([...(allowed ?? []), ...methodsLeft])] // 실패 뒤 목록이 비어 와도 앞서 알려 준 방식은 유지
      if (step === 0) return (step = 1), next({ type: 'password', username: h.username, password: pw })
      if (step === 1 && allowed?.includes('keyboard-interactive'))
        return (step = 2), next({ type: 'keyboard-interactive', username: h.username, prompt: (_n, _i, _l, prompts, finish) => finish(prompts.map(() => pw)) })
      ;(next as (m: unknown) => void)(false) // false = 더 시도할 방법 없음 (ssh2는 받지만 타입 정의에 빠져 있음)
    }
  } else {
    // 암호 걸린 키는 ssh-agent(Windows: OpenSSH Authentication Agent 서비스)에 등록된 걸 사용
    // shortcut: 앱에서 passphrase 직접 입력은 미지원, 필요해지면 입력 다이얼로그 추가
    const agent = process.platform === 'win32' ? (winAgentRunning() ? WIN_AGENT : undefined) : process.env.SSH_AUTH_SOCK
    const files = h.keyPath
      ? [h.keyPath.replace(/^~(?=$|[\\/])/, homedir())]
      : ['id_ed25519', 'id_ecdsa', 'id_rsa'].map((f) => join(homedir(), '.ssh', f)).filter((p) => existsSync(p))
    let locked = false
    for (const path of files) {
      // \\서버\공유 같은 네트워크 경로는 읽는 순간 Windows 로그인 정보(NTLM)가 그 서버로 갈 수 있어 거부
      if (/^(\\\\|\/\/)/.test(path)) throw new Error(tr('네트워크 경로의 키 파일은 쓸 수 없어요. PC에 복사한 뒤 선택하세요'))
      let buf: Buffer
      try {
        buf = readFileSync(path)
      } catch {
        throw new Error(tr('키 파일을 읽을 수 없어요: {0}', path))
      }
      if (utils.parseKey(buf) instanceof Error) locked = true // 암호 걸렸거나 형식 오류 → 건너뛰고 agent에 맡김
      else {
        cfg.privateKey = buf
        break
      }
    }
    if (agent) cfg.agent = agent
    if (!cfg.privateKey && !cfg.agent)
      throw new Error(locked ? tr('암호가 걸린 키예요. ssh-add로 ssh-agent에 등록하거나 다른 키를 선택하세요') : tr('~/.ssh에 개인 키가 없어요. 키 파일을 선택하세요'))
  }

  let rejected = false
  let hostKeyType = ''
  cfg.hostVerifier = (key: Buffer, verify: (ok: boolean) => void) => {
    hostKeyType = keyType(key)
    if (revoked(name, key)) {
      rejected = true
      return verify(false)
    }
    const c = check(name, key)
    if (c.status === 'ok') return verify(true)
    ask(wc, {
      variant: c.status === 'new' ? 'first' : 'changed',
      host: `${h.name} · ${h.host}:${h.port}`,
      keyType: typeLabel(keyType(key)),
      fingerprint: fingerprint(key),
      oldFingerprint: c.status === 'changed' ? fingerprint(c.oldKey) : undefined
    }).then(
      (a) => {
        // 화면이 보낸 답도 검사: 키가 바뀐 경우엔 '교체'만, 처음이면 '이번만'/'신뢰'만 허용
        const ok = c.status === 'new' ? a === 'once' || a === 'trust' : a === 'replace'
        try {
          if (ok && a !== 'once') trust(name, key)
        } catch {
          /* known_hosts 저장에 실패해도 이번 연결은 진행 (다음 접속 때 다시 물어봄) */
        }
        rejected = !ok
        verify(ok)
      },
      () => {
        rejected = true
        verify(false)
      }
    )
  }

  return new Promise((resolve, reject) => {
    const client = new Client()
    client.once('ready', () => resolve({ client, hostKeyType }))
    const noPassword = () => h.auth === 'password' && !!allowed && !allowed.some((m) => m === 'password' || m === 'keyboard-interactive')
    client.once('error', (e) =>
      reject(
        new Error(
          rejected
            ? tr('호스트 키를 확인하지 않아 연결을 취소했어요')
            : (e as { level?: string }).level === 'client-authentication' && noPassword()
              ? tr('이 기기는 비밀번호 로그인을 막아 두었어요 (SSH 키만 허용). 인증 방식을 SSH 키로 바꿔 주세요')
              : friendly(e)
        )
      )
    )
    try {
      client.connect(cfg)
    } catch (e) {
      reject(new Error(friendly(e as Error)))
    }
  })
}

export function registerSshIpc(): void {
  ipcMain.on('hostkey:answer', (_e, id: string, answer: Answer) => {
    pending.get(id)?.(answer)
    pending.delete(id)
  })

  // 연결 테스트: 접속·인증까지 해보고 바로 끊음
  ipcMain.handle('ssh:test', async (e, h: Host, password?: string) => {
    const { client } = await connect(e.sender, h, password)
    client.end()
    return tr('{0}@{1} 연결 성공', h.username, h.host)
  })

  // SSH 키 마법사: 지금 방식(비밀번호 등)으로 접속해 이 PC의 공개 키를 Device에 등록하고, 그 키만으로 접속되는지 확인
  ipcMain.handle('ssh:installKey', async (e, h: Host, password?: string) => {
    const key = ensureLocalKey()
    const { client } = await connect(e.sender, h, password)
    try {
      await new Promise<void>((resolve, reject) =>
        client.exec(INSTALL_KEY_CMD, (err, ch) => {
          if (err) return reject(err)
          ch.on('error', () => {})
          ch.on('data', () => {}) // 출력을 읽어 비워야 채널이 끝나고 close가 옴
          ch.stderr.on('data', () => {})
          ch.on('close', (code: number | null) => (code === 0 ? resolve() : reject(new Error(tr('Device에 키를 등록하지 못했어요 (홈 폴더에 쓸 수 있는지 확인하세요)')))))
          ch.end(key.pub + '\n')
        })
      )
    } finally {
      client.end()
    }
    // 키 파일로만 접속되는지 확인 (agent·비밀번호는 쓰지 않음)
    const check = await connect(e.sender, { ...h, auth: 'key', keyPath: key.path })
    check.client.end()
    return key.created ? tr('새 키를 만들어 Device에 등록했고, 키로 접속되는 것까지 확인했어요 ({0})', key.path) : tr('Device에 등록했고, 키로 접속되는 것까지 확인했어요 ({0})', key.path)
  })
}
