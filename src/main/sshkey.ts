import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir, hostname } from 'os'
import { join } from 'path'
import { utils } from 'ssh2'
import { tr } from './i18n.mts'

// SSH 키 마법사: 이 PC의 기본 키(~/.ssh/id_ed25519)를 쓰고, 없으면 만듦. 있는 키는 절대 덮어쓰지 않음
const PUB = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) [A-Za-z0-9+/=]+( [^\r\n]*)?$/

export function ensureLocalKey(): { pub: string; path: string; created: boolean } {
  const dir = join(homedir(), '.ssh')
  const priv = join(dir, 'id_ed25519')
  if (existsSync(priv + '.pub')) {
    const pub = readFileSync(priv + '.pub', 'utf8').split(/\r?\n/)[0].trim()
    if (!PUB.test(pub)) throw new Error(tr('공개 키 파일 형식이 이상해요: {0}.pub', priv))
    return { pub, path: priv, created: false }
  }
  if (existsSync(priv)) throw new Error(tr('개인 키({0})는 있는데 공개 키(.pub)가 없어요. ssh-keygen -y -f 로 만들거나 키 파일을 확인하세요', priv))
  const pair = utils.generateKeyPairSync('ed25519')
  const pub = `${pair.public.trim()} jetdeck@${hostname()}`
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(priv, pair.private, { mode: 0o600, flag: 'wx' })
  writeFileSync(priv + '.pub', pub + '\n', { mode: 0o644, flag: 'wx' })
  return { pub, path: priv, created: true }
}

// 공개 키를 Device의 authorized_keys에 넣는 셸 명령. 키는 명령에 넣지 않고 표준 입력으로 보냄 (따옴표 문제·명령 삽입 방지)
export const INSTALL_KEY_CMD =
  'umask 077; mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && ' +
  'read -r k && { grep -qxF "$k" ~/.ssh/authorized_keys || echo "$k" >> ~/.ssh/authorized_keys; }'
