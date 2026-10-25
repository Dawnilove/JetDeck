import { app } from 'electron'
import { createHash, createHmac } from 'crypto'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// 앱 전용 known_hosts(쓰기) + 사용자 ~/.ssh/known_hosts(읽기만). 같은 키 종류면 앱 파일이 우선
const appFile = () => join(app.getPath('userData'), 'known_hosts')
const sysFile = join(homedir(), '.ssh', 'known_hosts')

type Line = { patterns: string; type: string; key: string; raw: string }

function lines(path: string): string[] {
  try {
    return readFileSync(path, 'utf8').split(/\r?\n/)
  } catch {
    return []
  }
}

function read(path: string): Line[] {
  return lines(path)
    .map((raw) => {
      const [patterns, type, key] = raw.trim().split(/\s+/)
      return { patterns, type, key, raw }
    })
    // 주석, 빈 줄, @cert-authority/@revoked 표시 줄은 건너뜀
    .filter((l) => l.key && !l.patterns.startsWith('#') && !l.patterns.startsWith('@'))
}

// shortcut: 와일드카드(*, ?)와 부정(!) 패턴은 무시, 필요해지면 OpenSSH 매칭 규칙 구현
export function hostMatches(patterns: string, name: string): boolean {
  if (patterns.startsWith('|1|')) {
    // HashKnownHosts 형식: |1|salt|HMAC-SHA1(host). 깨진 줄은 일치하지 않는 것으로 봄
    const [, , salt = '', hash] = patterns.split('|')
    try {
      return createHmac('sha1', Buffer.from(salt, 'base64')).update(name).digest('base64') === hash
    } catch {
      return false
    }
  }
  return patterns.split(',').some((p) => p.toLowerCase() === name.toLowerCase())
}

// known_hosts에 쓰는 이름: 22번이면 host, 아니면 [host]:port
export const knownName = (host: string, port: number) => (port === 22 ? host : `[${host}]:${port}`)

// 키 바이트(SSH 형식) 맨 앞에 키 종류 문자열이 들어 있음
export const keyType = (key: Buffer) => key.subarray(4, 4 + key.readUInt32BE(0)).toString()

export const fingerprint = (key: Buffer) => 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')

function known(name: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const l of [...read(sysFile), ...read(appFile())]) if (hostMatches(l.patterns, name)) map.set(l.type, l.key)
  return map
}

export type Check = { status: 'ok' } | { status: 'new' } | { status: 'changed'; oldKey: Buffer }

export function check(name: string, key: Buffer): Check {
  const map = known(name)
  const old = map.get(keyType(key))
  // 이 호스트의 다른 종류 키를 이미 아는데 처음 보는 종류가 오면 '바뀐 키'로 경고 (공격자가 다른 종류 키로 경고를 피하는 것 방지)
  if (!old) return map.size ? { status: 'changed', oldKey: Buffer.from([...map.values()][0], 'base64') } : { status: 'new' }
  return old === key.toString('base64') ? { status: 'ok' } : { status: 'changed', oldKey: Buffer.from(old, 'base64') }
}

// known_hosts의 "@revoked 호스트 종류 키" 줄에 있는 키는 무조건 거부
export function revoked(name: string, key: Buffer): boolean {
  const b64 = key.toString('base64')
  return [sysFile, appFile()].some((f) =>
    lines(f).some((raw) => {
      const [mark, patterns, , k] = raw.trim().split(/\s+/)
      return mark === '@revoked' && k === b64 && hostMatches(patterns, name)
    })
  )
}

// 이미 아는 키 종류를 먼저 협상하게 해서, 다른 종류 키를 '처음 보는 키'로 오인하지 않게 함
export function preferredAlgorithms(name: string): string[] {
  return [...known(name).keys()].flatMap((t) => (t === 'ssh-rsa' ? ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'] : [t]))
}

// 신뢰/교체: 앱 파일에서 같은 호스트·종류 줄을 지우고 새 줄 추가
export function trust(name: string, key: Buffer): void {
  const type = keyType(key)
  const keep = read(appFile()).filter((l) => !(l.type === type && hostMatches(l.patterns, name)))
  const text = [...keep.map((l) => l.raw), `${name} ${type} ${key.toString('base64')}`].join('\n') + '\n'
  const tmp = appFile() + '.tmp'
  writeFileSync(tmp, text)
  renameSync(tmp, appFile())
}
