// 팩 명령의 위험도 계산 (5.0.0): 작은 셸 파서 + 읽기 허용 목록. "읽기로 증명되지 않으면 물어본다" — 모르는 것은 전부 change 이상
// 팩 전용이다. MCP용 danger.mts는 별개(단어 목록)이며 건드리지 않음. Electron 없이 시험 (risk.test.mts)
export type Risk = 'read' | 'change' | 'danger'
export type Reason =
  | 'delete' | 'disk' | 'power' | 'privilege' | 'shell' | 'network' | 'package' | 'users' | 'system' // danger 계열
  | 'sensitive' | 'overwrite' | 'write' | 'unknown' | 'unsafe' | 'dynamic' | 'syntax' | 'redirect' | 'newline' | 'background' | 'assign'
  | 'input' // 5.1.0: 사용자가 입력한 값 때문에 위험도가 올라감
export type Analysis = { risk: Risk; reasons: Reason[] }
export type AnalyzeOpts = { stream?: boolean } // stream: 끝나지 않는 읽기 명령(journalctl -f 등)도 읽기로 인정 (mode:'stream' 항목 전용)

// 앱이 확인창·허용 창에 보여 줄 이유 (팩이 쓴 글자가 아니라 앱 글자)
export const REASON_TEXT: Record<Reason, string> = {
  delete: '삭제 명령이에요',
  disk: '디스크·파일 시스템을 바꾸는 명령이에요',
  power: '재부팅·종료 명령이에요',
  privilege: '관리자 권한으로 실행해요',
  shell: '다른 셸이나 코드를 해석해서 실행해요',
  network: '외부로 데이터를 보낼 수 있어요',
  package: '패키지를 설치·삭제해요',
  users: '계정을 바꾸는 명령이에요',
  system: '시스템 설정을 바꾸는 명령이에요',
  sensitive: '비밀번호·키 같은 민감한 파일에 접근해요',
  overwrite: '파일을 덮어써요',
  write: '파일이나 설정을 바꿔요',
  unknown: '읽기 전용인지 확인할 수 없는 명령이에요',
  unsafe: '읽기 전용이 아닌 옵션이 있어요',
  dynamic: '값이 실행할 때 정해져서 확인할 수 없어요',
  syntax: '앱이 읽지 못하는 셸 문법이 들어 있어요',
  redirect: '입출력 방향을 바꿔요',
  newline: '여러 줄 명령이에요',
  background: '백그라운드로 실행해요',
  assign: '변수를 설정하고 실행해요',
  input: '입력한 값 때문에 위험도가 올라갔어요'
}
const RANK: Record<Risk, number> = { read: 0, change: 1, danger: 2 }
export const maxRisk = (a: Risk, b: Risk): Risk => (RANK[a] >= RANK[b] ? a : b)

const MAX_LEN = 8000
const MAX_DEPTH = 6
const MAX_CMDS = 200

// ───────────── 파서 ─────────────
type Word = { text: string; dyn: boolean; glob: boolean; subs: Script[] } // dyn: 값이 실행 때 정해짐($변수·$(…)·{a,b}), glob: 따옴표 밖 * ? [
type Redir = { op: string; fd: string; target?: Word }
type Cmd = { words: Word[]; redirs: Redir[] }
type Script = { cmds: Cmd[]; flags: Set<Reason> }

const BAD_CHAR = /[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/
const isNameStart = (c: string) => /[A-Za-z_]/.test(c)

// 하나의 스크립트를 읽음. inSub면 짝이 맞는 ')'에서 끝남 (같은 문법으로 읽으므로 bash와 경계가 어긋나지 않음)
function parseScript(s: string, start: number, inSub: boolean, depth: number): { script: Script; end: number } {
  const script: Script = { cmds: [], flags: new Set() }
  const flag = (r: Reason) => script.flags.add(r)
  if (depth > MAX_DEPTH) {
    flag('syntax')
    return { script, end: s.length }
  }
  let cmd: Cmd = { words: [], redirs: [] }
  let pending: Redir | null = null
  let buf = ''
  let unq = '' // 따옴표 밖 글자 (중괄호 확장 감지용)
  let dyn = false
  let glob = false
  let has = false
  let quoted = false
  let subs: Script[] = []
  let i = start

  const resetWord = () => {
    buf = ''
    unq = ''
    dyn = false
    glob = false
    has = false
    quoted = false
    subs = []
  }
  const endWord = () => {
    if (!has) return
    if (/\{[^{}]*(,|\.\.)[^{}]*\}/.test(unq)) dyn = true // {a,b} {1..3} 중괄호 확장
    const w: Word = { text: buf, dyn, glob, subs }
    if (pending) {
      pending.target = w
      pending = null
    } else cmd.words.push(w)
    resetWord()
  }
  const endCmd = () => {
    endWord()
    if (pending) {
      flag('syntax')
      pending = null
    }
    if (cmd.words.length || cmd.redirs.length) script.cmds.push(cmd)
    cmd = { words: [], redirs: [] }
  }
  const add = (ch: string, plain: boolean) => {
    buf += ch
    has = true
    if (plain) unq += ch
  }
  // $… 처리 (i는 '$' 위치). 처리한 만큼 i를 옮김
  const dollar = (inDq: boolean) => {
    const n = s[i + 1]
    if (n === '(') {
      if (s[i + 2] === '(') flag('syntax') // 산술 $(( )) — 읽지 않음
      const r = parseScript(s, i + 2, true, depth + 1)
      subs.push(r.script)
      add(s.slice(i, r.end + 1), false)
      dyn = true
      i = r.end + 1
    } else if (n === '{') {
      const close = s.indexOf('}', i + 2)
      const name = close < 0 ? '' : s.slice(i + 2, close)
      if (!/^[A-Za-z_]\w*$/.test(name)) {
        flag('syntax')
        add('$', !inDq)
        i++
      } else {
        if (name === 'HOME') add('~', false) // 홈은 ~로 취급 → 민감 경로 검사에 걸림
        else (add(s.slice(i, close + 1), false), (dyn = true))
        i = close + 1
      }
    } else if (n && isNameStart(n)) {
      let j = i + 1
      while (j < s.length && /\w/.test(s[j])) j++
      const name = s.slice(i + 1, j)
      if (name === 'HOME') add('~', false)
      else (add(s.slice(i, j), false), (dyn = true))
      i = j
    } else if (n && /[?#$!@*\-0-9]/.test(n)) {
      add('$' + n, false)
      dyn = true
      i += 2
    } else if (!inDq && (n === "'" || n === '"')) {
      flag('syntax') // $'…' (이스케이프 해석) $"…" — 읽지 않음
      add('$', true)
      i++
    } else {
      add('$', !inDq)
      i++
    }
  }
  // 백틱 `…` : 짝을 찾아 안쪽을 따로 읽음 (백틱은 항상 읽기가 아님)
  const backtick = () => {
    let j = i + 1
    let inner = ''
    for (; j < s.length && s[j] !== '`'; j++) {
      if (s[j] === '\\' && j + 1 < s.length && '`\\$'.includes(s[j + 1])) inner += s[++j]
      else inner += s[j]
    }
    if (j >= s.length) flag('syntax')
    flag('syntax')
    const r = parseScript(inner, 0, false, depth + 1)
    subs.push(r.script)
    add('`' + inner + '`', false)
    dyn = true
    i = j + 1
  }

  while (i < s.length) {
    const c = s[i]
    if (BAD_CHAR.test(c)) {
      flag('syntax')
      add(c, true)
      i++
    } else if (c === ' ' || c === '\t') {
      endWord()
      i++
    } else if (c === '\n') {
      flag('newline')
      endCmd()
      i++
    } else if (c === "'") {
      const j = s.indexOf("'", i + 1)
      if (j < 0) {
        flag('syntax')
        add(s.slice(i + 1), false)
        i = s.length
      } else {
        add(s.slice(i + 1, j), false)
        i = j + 1
      }
      quoted = true
      has = true
    } else if (c === '"') {
      i++
      quoted = true
      has = true
      let closed = false
      while (i < s.length) {
        const d = s[i]
        if (d === '"') {
          closed = true
          i++
          break
        }
        if (d === '\\') {
          const e = s[i + 1]
          if (e === undefined) {
            flag('syntax')
            i++
          } else if (e === '\n') {
            flag('newline')
            i += 2
          } else if ('$`"\\'.includes(e)) {
            add(e, false)
            i += 2
          } else {
            add('\\' + e, false)
            i += 2
          }
        } else if (d === '$') dollar(true)
        else if (d === '`') backtick()
        else {
          if (BAD_CHAR.test(d)) flag('syntax')
          add(d, false)
          i++
        }
      }
      if (!closed) flag('syntax')
    } else if (c === '\\') {
      const e = s[i + 1]
      if (e === undefined) {
        flag('syntax')
        i++
      } else if (e === '\n') {
        flag('newline') // 줄 이어쓰기
        i += 2
      } else {
        add(e, false)
        quoted = true
        i += 2
      }
    } else if (c === '$') dollar(false)
    else if (c === '`') backtick()
    else if (c === ';') {
      if (s[i + 1] === ';' || s[i + 1] === '&') flag('syntax') // case 문법
      endCmd()
      i += s[i + 1] === ';' || s[i + 1] === '&' ? 2 : 1
    } else if (c === '|') {
      endCmd()
      i += s[i + 1] === '|' || s[i + 1] === '&' ? 2 : 1
    } else if (c === '&') {
      if (s[i + 1] === '&') {
        endCmd()
        i += 2
      } else if (s[i + 1] === '>') {
        endWord()
        const op = s[i + 2] === '>' ? '&>>' : '&>'
        pending = { op, fd: '' }
        cmd.redirs.push(pending)
        i += op.length
      } else {
        flag('background')
        endCmd()
        i++
      }
    } else if (c === '<' || c === '>') {
      const fd = has && !quoted && /^\d+$/.test(buf) ? buf : ''
      if (fd) resetWord()
      else endWord()
      const rest = s.slice(i, i + 3)
      if (s[i + 1] === '(') {
        // 프로세스 치환 <( ) >( ) : 안쪽을 읽어 위험도에 더함, 값은 실행 때 정해지는 파일 이름
        const r = parseScript(s, i + 2, true, depth + 1)
        subs.push(r.script)
        if (c === '>') flag('redirect')
        add(s.slice(i, r.end + 1), false)
        dyn = true
        i = r.end + 1
        continue
      }
      let op: string
      if (c === '<') op = rest === '<<<' ? '<<<' : rest === '<<-' ? '<<-' : s[i + 1] === '<' ? '<<' : s[i + 1] === '&' ? '<&' : s[i + 1] === '>' ? '<>' : '<'
      else op = s[i + 1] === '>' ? '>>' : s[i + 1] === '&' ? '>&' : s[i + 1] === '|' ? '>|' : '>'
      pending = { op, fd }
      cmd.redirs.push(pending)
      i += op.length
    } else if (c === '(' || c === ')') {
      if (c === ')' && inSub) {
        endCmd()
        return { script, end: i }
      }
      flag('syntax') // 서브셸·함수 정의
      endCmd()
      i++
    } else if (c === '#' && !has) {
      flag('syntax') // 주석: 어디까지가 주석인지 bash와 어긋나지 않게 읽지 않음
      i = s.length
    } else if (c === '~' && !has) {
      let j = i + 1
      while (j < s.length && /[A-Za-z0-9_.\-+]/.test(s[j])) j++
      const user = s.slice(i + 1, j)
      add('~' + user, true)
      if (user === '+' || user === '-') dyn = true
      i = j
    } else {
      if (c === '*' || c === '?' || c === '[') glob = true
      add(c, true)
      i++
    }
  }
  if (inSub) flag('syntax') // ')'를 못 찾음
  endCmd()
  return { script, end: s.length }
}

// ───────────── 민감 경로 · 막힌 경로 ─────────────
// 위치와 상관없이 이름으로 잡음: 상대 경로·../ 우회·cd 뒤 상대 경로에도 걸리도록
const SENS: RegExp[] = [
  /(^|\/)\.(ssh|gnupg|aws|azure|kube|docker|netrc|git-credentials|pgpass|npmrc|pypirc|jetdeck|mozilla|password-store)(\/|$)/i,
  /(^|\/)\.config\/(gcloud|gh|rclone|nanoterm|jetdeck|git\/credentials)(\/|$)/i,
  /(^|\/)\.local\/share\/(keyrings|nanoterm)(\/|$)/i,
  /(^|\/)\.env(\.[^/]*)?$/i,
  /(^|\/)[^/]*\.env$/i,
  /\.(pem|key|p12|pfx|jks|keystore|ppk|kdbx|gpg)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)[^/]*$/i,
  /(^|\/)authorized_keys2?$/i,
  /(^|\/)\.[a-z_]*(history|hst)$/i,
  /(^|\/)\.viminfo$/i,
  /(^|\/)(gshadow|shadow|sudoers)[^/]*(\/|$)/i,
  /(^|\/)sudoers\.d(\/|$)/i,
  /^\/etc\/(ssh\/ssh_host_[^/]*|ssl\/private|NetworkManager\/system-connections|wpa_supplicant|ppp\/(chap|pap)-secrets|security)(\/|$)/i,
  /^\/root(\/|$)/,
  /^\/proc\/[^/]+\/(environ|mem|mountinfo|root|cwd)(\/|$)/,
  /^\/proc\/(kcore|kmsg|kallsyms)$/,
  /^\/dev\/(mem|kmem|port|sd[a-z]|nvme|mmcblk|dm-|loop|mapper|disk\/)/,
  /(^|\/)(\.?secrets?|\.?credentials?|\.token)\.(json|ya?ml|txt|conf|ini|toml)$/i,
  /(^|\/)\.(token|secrets?|credentials?)$/i
]
const REL_SAMPLES = ['.ssh', '.ssh/id_rsa', '.ssh/authorized_keys', '.aws', '.aws/credentials', '.gnupg', '.gnupg/x', '.netrc', '.git-credentials', '.env', '.bash_history', '.zsh_history', '.python_history', '.psql_history', '.docker', '.docker/config.json', '.kube', '.kube/config', '.config/gcloud', '.config/gcloud/x', '.config/gh/hosts.yml', '.jetdeck', '.pgpass', '.npmrc', '.pypirc', 'x.pem', 'x.key', 'id_rsa', '.local/share/keyrings']
const ABS_SAMPLES = ['/etc/shadow', '/etc/gshadow', '/etc/sudoers', '/etc/sudoers.d/x', '/etc/ssh/ssh_host_rsa_key', '/etc/ssl/private/x.key', '/etc/NetworkManager/system-connections/x.nmconnection', '/root', '/root/x', '/proc/1/environ', '/proc/self/environ', '/dev/mem', '/dev/kmem', '/dev/sda', '/dev/mmcblk0', '/dev/nvme0n1']
for (const u of ['u', '~']) for (const r of REL_SAMPLES) ABS_SAMPLES.push(`/home/${u}/${r}`)

// ~ → /home/~ (홈을 가리키는 표시), ~이름 → /home/이름 (~root → /root), 그리고 . .. // 를 글자만으로 정리 (심볼릭 링크는 모름)
function normPath(t: string): string {
  let p = t
  if (p === '~' || p.startsWith('~/')) p = '/home/~' + p.slice(1)
  else if (/^~root(\/|$)/.test(p)) p = '/root' + p.slice(5)
  else if (/^~[^/]/.test(p)) p = '/home/' + p.slice(1)
  if (!p.includes('/') && p !== '.' && p !== '..') return p
  const abs = p.startsWith('/')
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (!abs) out.push('..')
    } else out.push(seg)
  }
  return (abs ? '/' : '') + out.join('/')
}
// 한 글자에 경로가 숨어 있을 수 있는 모양들: 그대로, a=PATH, -fPATH, a,b, a:b
function candidates(t: string): string[] {
  const set = new Set<string>([t])
  for (const piece of t.split(/[=,:]/).slice(1)) set.add(piece)
  const m = t.match(/^-[A-Za-z](.+)$/)
  if (m) set.add(m[1])
  return [...set].map(normPath)
}
function segRegex(pat: string): RegExp {
  let re = ''
  for (let k = 0; k < pat.length; k++) {
    const c = pat[k]
    if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else if (c === '[') {
      const close = pat.indexOf(']', k + 2)
      if (close < 0) re += '\\['
      else {
        let body = pat.slice(k + 1, close).replace(/\\/g, '\\\\')
        if (body[0] === '!') body = '^' + body.slice(1)
        re += '[' + body + ']'
        k = close
      }
    } else re += c.replace(/[.+^${}()|\\/]/g, '\\$&')
  }
  return new RegExp('^' + re + '$')
}
function globHitsSensitive(pattern: string): boolean {
  const pats = pattern.split('/')
  const abs = pattern.startsWith('/')
  const samples = abs ? ABS_SAMPLES : REL_SAMPLES
  const res = pats.map((p) => (p === '' ? null : segRegex(p)))
  return samples.some((sample) => {
    const segs = sample.split('/')
    if (segs.length !== pats.length) return false
    return segs.every((seg, k) => {
      const re = res[k]
      if (!re) return seg === ''
      if (seg.startsWith('.') && /^[*?[]/.test(pats[k])) return false // * 는 점으로 시작하는 이름과 맞지 않음
      return re.test(seg)
    })
  })
}
function sensitiveWord(w: Word): boolean {
  for (const c of candidates(w.text)) {
    if (SENS.some((re) => re.test(c))) return true
    if (w.glob && c.length && globHitsSensitive(c)) return true
  }
  return false
}

// 지우는 명령이 가리키면 안 되는 경로
const BLOCKED = ['/', '/boot', '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib32', '/lib64', '/dev', '/proc', '/sys', '/var', '/home', '/root', '/opt/nvidia', '/usr/local/cuda', '/home/~']
const isBlockedPath = (p: string): boolean => p === '/' || BLOCKED.some((b) => p === b || (b !== '/' && b !== '/var' && b !== '/home' && b !== '/home/~' && p.startsWith(b + '/')))
function blockedWord(w: Word): string | null {
  if (w.dyn) return w.text // 실행 때 정해지는 대상 → 증명 못 함
  let t = w.text
  if (w.glob) {
    const k = t.search(/[*?[]/)
    t = t.slice(0, k)
    if (!t.endsWith('/') && k >= 0 && t !== '') t = t.slice(0, t.lastIndexOf('/') + 1) // 'a/b*' → 'a/'
    if (t === '') return '*' // 현재 위치(홈)의 전부
  }
  const p = normPath(t.replace(/(.)\/+$/, '$1'))
  if (p === '.' || p === '..' || p === '' || p === '/home/~') return t === '~' || p === '/home/~' ? '~' : p || '.'
  return isBlockedPath(p) ? p.replace('/home/~', '~') : null
}

// ───────────── 명령 분류 ─────────────
type Verdict = null | [Risk, Reason] // null = 읽기로 증명됨
const UNSAFE: Verdict = ['change', 'unsafe']
type Args = { raw: string[]; long: string[]; short: string; pos: string[] }
function parseArgs(raw: string[]): Args {
  const long: string[] = []
  let short = ''
  const pos: string[] = []
  let rest = false
  for (const a of raw) {
    if (rest) pos.push(a)
    else if (a === '--') rest = true
    else if (a.startsWith('--')) long.push(a.split('=')[0])
    else if (a.startsWith('-') && a.length > 1) short += a.slice(1)
    else pos.push(a)
  }
  return { raw, long, short, pos }
}
// 읽기 명령의 위험 옵션 검사. 긴 옵션은 약어(--vac)도 같은 옵션이므로 앞부분만 같아도 막음
const simple = (o: { badLong?: string[]; badShort?: string; maxPos?: number } = {}) => (a: Args): Verdict => {
  if (o.badShort && [...a.short].some((c) => o.badShort!.includes(c))) return UNSAFE
  if (o.badLong && a.long.some((l) => o.badLong!.some((b) => b.startsWith(l)))) return UNSAFE
  if (o.maxPos !== undefined && a.pos.length > o.maxPos) return UNSAFE
  return null
}
// 옵션 이름이 목록 안에 정확히 있을 때만 통과 (모르는 옵션 = 읽기 아님)
const only = (ok: string[], valued: string[] = []) => (a: Args): Verdict => {
  const set = new Set(ok)
  for (let k = 0; k < a.raw.length; k++) {
    const x = a.raw[k]
    if (x === '--') break
    if (!x.startsWith('-') || x === '-') continue
    const name = x.startsWith('--') ? x.split('=')[0] : x
    if (valued.includes(name) && !x.includes('=')) k++
    else if (!set.has(name) && !valued.includes(name)) return UNSAFE
  }
  return null
}
const SIM = /^(--simulate|--dry-run|--just-print|--recon|--no-act)$/

const dateCheck = (a: Args): Verdict => {
  if (a.short.includes('s') || a.long.some((l) => '--set'.startsWith(l))) return UNSAFE
  for (let k = 0; k < a.raw.length; k++) {
    const x = a.raw[k]
    if (x === '-d' || x === '-r' || x === '--date' || x === '--reference') k++
    else if (x.startsWith('-')) continue
    else if (!x.startsWith('+')) return UNSAFE // date MMDDhhmm 은 시계를 바꿈
  }
  return null
}
const ipCheck = (a: Args): Verdict => {
  const OPT = new Set(['-4', '-6', '-0', '-B', '-D', '-br', '-brief', '-c', '-color', '-d', '-details', '-j', '-json', '-o', '-oneline', '-p', '-pretty', '-s', '-stats', '-t', '-timestamp', '-a', '-all', '-h', '-human', '-r', '-resolve'])
  const words = [...a.raw]
  while (words.length && words[0].startsWith('-')) if (!OPT.has(words.shift()!)) return UNSAFE
  const obj = words.shift()
  if (!obj) return null
  if (!['a', 'addr', 'address', 'l', 'link', 'r', 'route', 'n', 'neigh', 'neighbor', 'neighbour', 'rule', 'maddress'].includes(obj)) return UNSAFE
  const verb = words.shift()
  if (verb === undefined || ['show', 'list', 'ls', 'sh', 'lst'].includes(verb) || (verb === 'get' && /^r/.test(obj))) return null
  return UNSAFE
}
const topCheck = (a: Args): Verdict => (a.short.includes('b') && a.short.includes('n') && a.pos.every((p) => /^[\w%+.,-]+$/.test(p)) ? simple({ badShort: 'k' })(a) : UNSAFE) // -b 없이는 화면을 점유함
const AWK_BAD = /system|getline|close|fflush|ENVIRON|\||>|@|\/dev\/|`/
const awkCheck = (a: Args): Verdict => {
  let k = 0
  while (k < a.raw.length && a.raw[k].startsWith('-') && a.raw[k] !== '--') {
    const o = a.raw[k]
    if (o === '-F' || o === '-v') k += 2
    else if (/^-F./.test(o) || /^-v./.test(o)) k++
    else return UNSAFE
  }
  const prog = a.raw[k]
  return prog === undefined || AWK_BAD.test(prog) ? UNSAFE : null
}
const SED_ADDR = String.raw`(?:\d+(?:,(?:\d+|\$))?|\$|\/[^\/\\]*\/)?`
const SED_SIMPLE = new RegExp(`^${SED_ADDR}\\s*!?(?:p|d|q|=)$`)
const sedCheck = (a: Args): Verdict => {
  const scripts: string[] = []
  const files: string[] = []
  let k = 0
  for (; k < a.raw.length; k++) {
    const x = a.raw[k]
    if (x === '-e') scripts.push(a.raw[++k] ?? '\u0000')
    else if (x === '--expression') scripts.push(a.raw[++k] ?? '\u0000')
    else if (x.startsWith('--expression=')) scripts.push(x.slice(13))
    else if (['-n', '-E', '-r', '-s', '-z', '-u', '--quiet', '--silent', '--regexp-extended', '--separate', '--null-data', '--unbuffered'].includes(x)) continue
    else if (x === '--') {
      files.push(...a.raw.slice(k + 1))
      break
    } else if (x.startsWith('-') && x.length > 1) return UNSAFE // -i -f --in-place --file --sandbox 아닌 것 등
    else files.push(x)
  }
  if (!scripts.length) {
    const first = files.shift()
    if (first === undefined) return UNSAFE
    scripts.push(first)
  }
  for (const sc of scripts) {
    if (SED_SIMPLE.test(sc)) continue
    const m = sc.match(new RegExp(`^${SED_ADDR}\\s*s([^\\\\\\sA-Za-z0-9])`))
    if (!m) return UNSAFE
    const d = m[1].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    if (!new RegExp(`^${SED_ADDR}\\s*s${d}(?:\\\\.|[^${d}\\\\])*${d}(?:\\\\.|[^${d}\\\\])*${d}[gpiI0-9]*$`).test(sc)) return UNSAFE
  }
  return null
}
const SYSTEMCTL_READ = new Set(['status', 'show', 'list-units', 'list-unit-files', 'list-sockets', 'list-timers', 'list-dependencies', 'list-jobs', 'list-machines', 'is-active', 'is-enabled', 'is-failed', 'is-system-running', 'get-default', 'cat'])
const SYSTEMCTL_POWER = new Set(['reboot', 'poweroff', 'halt', 'kexec', 'rescue', 'emergency', 'isolate', 'suspend', 'hibernate', 'hybrid-sleep'])
const SYSTEMCTL_OPT = new Set(['-l', '--full', '-a', '--all', '--no-pager', '--no-legend', '--plain', '--failed', '--user', '--system', '--value', '-r', '--recursive', '--reverse', '--after', '--before', '-q', '--quiet', '-t', '--type', '--state', '-n', '--lines', '-o', '--output', '-p', '--property', '--show-types', '--no-ask-password'])
const SYSTEMCTL_VALUED = new Set(['-t', '-n', '-o', '-p'])
const systemctlCheck = (a: Args): Verdict => {
  let verb: string | undefined
  for (let k = 0; k < a.raw.length; k++) {
    const x = a.raw[k]
    if (x.startsWith('-')) {
      const name = x.startsWith('--') ? x.split('=')[0] : x
      if (!SYSTEMCTL_OPT.has(name)) return UNSAFE // --host -H --machine --root --force --now … 는 읽기 아님
      if (SYSTEMCTL_VALUED.has(name)) k++
    } else if (verb === undefined) verb = x
  }
  if (verb === undefined || SYSTEMCTL_READ.has(verb)) return null
  return SYSTEMCTL_POWER.has(verb) ? ['danger', 'power'] : ['change', 'write']
}
const APT_INSTALLISH = new Set(['install', 'remove', 'purge', 'autoremove', 'upgrade', 'dist-upgrade', 'full-upgrade', 'reinstall', 'build-dep', 'source', 'satisfy', 'autopurge'])
const aptCheck = (a: Args): Verdict => {
  if (!only(['--upgradable', '-u', '--installed', '-i', '--all-versions', '-a', '--manual-installed', '-q', '-qq', '--quiet', '-v', '--verbose'])(a)) {
    const sub = a.pos[0]
    if (sub && ['list', 'show', 'search', 'policy', 'depends', 'rdepends'].includes(sub)) return null
  }
  const sub = a.pos[0]
  if (sub && APT_INSTALLISH.has(sub)) return ['danger', 'package']
  return ['change', 'write']
}
const aptCacheCheck = (a: Args): Verdict => {
  const sub = a.pos[0]
  if (sub === undefined || !['policy', 'show', 'showpkg', 'search', 'depends', 'rdepends', 'madison', 'stats', 'pkgnames', 'showsrc', 'unmet'].includes(sub)) return UNSAFE
  return a.short.includes('o') || a.short.includes('c') || a.long.some((l) => '--option'.startsWith(l) || '--config-file'.startsWith(l)) ? UNSAFE : null
}
const aptGetCheck = (a: Args): Verdict => {
  const sub = a.pos[0]
  const sim = a.raw.some((x) => SIM.test(x)) || a.short.includes('s')
  if (sim && sub && ['upgrade', 'dist-upgrade', 'full-upgrade', 'autoremove', 'install', 'remove', 'purge', 'reinstall', 'update', 'clean', 'autoclean', 'check'].includes(sub)) {
    return only(['-s', '-y', '-q', '-qq', '-V', '-sy', '-ys', '-qs', '-sq', '--simulate', '--dry-run', '--just-print', '--recon', '--no-act', '--yes', '--assume-yes', '--quiet', '--no-install-recommends', '--only-upgrade', '--ignore-hold'])(a)
  }
  if (sub && APT_INSTALLISH.has(sub)) return ['danger', 'package']
  return ['change', 'write']
}
const dpkgCheck = (a: Args): Verdict => {
  const READ_OPT = new Set(['-l', '--list', '-s', '--status', '-L', '--listfiles', '-S', '--search', '-V', '--verify', '-C', '--audit', '-p', '--print-avail', '--get-selections', '--print-architecture', '--version', '--compare-versions', '-W', '--show'])
  const opts = a.raw.filter((x) => x.startsWith('-') && x !== '--')
  if (opts.length && opts.every((o) => READ_OPT.has(o.split('=')[0]))) return null
  return opts.some((o) => ['-i', '--install', '-r', '--remove', '-P', '--purge', '--configure', '--unpack', '-x', '--extract', '--set-selections', '--clear-avail'].includes(o)) ? ['danger', 'package'] : UNSAFE
}
const ROS2: Record<string, string[]> = {
  topic: ['list', 'info', 'type', 'find'], node: ['list', 'info'], service: ['list', 'type', 'find'], param: ['list', 'get', 'describe', 'dump'],
  pkg: ['list', 'prefix', 'executables', 'xml'], interface: ['list', 'show', 'package', 'packages', 'proto'], action: ['list', 'info', 'type', 'find'], component: ['list']
}
const ros2Check = (a: Args): Verdict => {
  if (a.long.some((l) => /output|dir|file/.test(l)) || a.short.includes('o')) return UNSAFE // param dump --output-dir 등은 파일을 씀
  const [sub, verb] = a.pos
  if (sub === 'doctor' || sub === 'wtf') return a.pos.length === 1 && !a.raw.some((x) => x.startsWith('--') && !['--report', '-r', '--report-failed', '-rf', '--include-warning', '-iw'].includes(x)) ? null : UNSAFE
  return sub && ROS2[sub] && verb && ROS2[sub].includes(verb) ? null : UNSAFE
}
const GIT_BAD_LONG = /output|ext-diff|textconv|exec|pack|pager|dir$|tree|open-files|namespace|config|submodule|signature/
// 긴 옵션은 약어(--ext-d)도 같은 옵션이므로, 앱이 끄는 기능(외부 diff·textconv·서브모듈 안 보기)을 다시 켜는 옵션은 앞부분만 같아도 막음
const GIT_BAD_ABBREV = ['--ext-diff', '--textconv', '--ignore-submodules', '--submodule', '--recurse-submodules', '--show-signature', '--paginate']
const GIT_SUB = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'describe', 'blame', 'ls-files', 'shortlog', 'rev-list', 'diff-tree', 'ls-tree', 'cat-file', 'show-ref', 'merge-base'])
const gitCheck = (a: Args): Verdict => {
  const raw = [...a.raw]
  while (raw[0]?.startsWith('-')) {
    const g = raw.shift()!
    if (g === '-C') raw.shift()
    else if (g !== '--no-pager' && g !== '--no-optional-locks') return UNSAFE
  }
  const sub = raw.shift()
  if (!sub) return null
  if (['push', 'clone', 'fetch', 'pull', 'ls-remote', 'submodule', 'remote-ext'].includes(sub)) return ['danger', 'network']
  const rest = parseArgs(raw)
  if (GIT_SUB.has(sub)) return rest.long.some((l) => GIT_BAD_LONG.test(l) || GIT_BAD_ABBREV.some((b) => b.startsWith(l))) || rest.short.includes('O') ? UNSAFE : null
  if (sub === 'branch') return raw.every((x) => ['-a', '-r', '-v', '-vv', '--list', '-l', '--show-current', '--all', '--remotes', '--verbose'].includes(x)) ? null : ['change', 'write']
  if (sub === 'tag') return raw.every((x) => ['-l', '--list', '-n'].includes(x)) ? null : ['change', 'write']
  if (sub === 'remote') return raw.length === 1 && raw[0] === '-v' ? null : raw.length === 0 ? null : ['danger', 'network']
  if (sub === 'stash') return raw.length >= 1 && ['list', 'show'].includes(raw[0]) ? null : ['change', 'write']
  return ['change', 'write']
}

type Check = (a: Args) => Verdict
const nothing = simple()
const READ_CMDS: Record<string, Check> = {
  cat: nothing, head: nothing, tail: simple({ badShort: 'fF', badLong: ['--follow', '--retry', '--pid'] }), wc: nothing, cut: nothing,
  sort: simple({ badShort: 'o', badLong: ['--output', '--compress-program'] }), uniq: simple({ maxPos: 1 }), tr: nothing,
  grep: nothing, egrep: nothing, fgrep: nothing, ls: nothing, df: nothing, du: nothing, free: nothing, uptime: nothing,
  date: dateCheck, hostname: simple({ badShort: 'Fb', badLong: ['--file', '--boot'], maxPos: 0 }), uname: simple({ maxPos: 0 }), nproc: simple({ maxPos: 0 }),
  id: nothing, whoami: nothing, groups: nothing, who: nothing, w: nothing, last: nothing, locale: nothing, getconf: nothing, vmstat: nothing, pwd: nothing, which: nothing,
  true: nothing, false: nothing, column: nothing, nl: nothing, tac: nothing, rev: nothing, diff: nothing, comm: nothing, md5sum: nothing, sha1sum: nothing, sha256sum: nothing, cksum: nothing,
  lsblk: nothing, lsusb: nothing, lspci: nothing, lsmod: simple({ maxPos: 0 }), lscpu: nothing, findmnt: simple({ badLong: ['--poll'] }), pgrep: nothing, pidof: nothing,
  ip: ipCheck, ss: simple({ badShort: 'KDF', badLong: ['--kill', '--diag', '--filter'] }), ps: nothing, top: topCheck,
  env: (a) => (a.raw.length === 0 || (a.raw.length === 1 && ['-0', '--null'].includes(a.raw[0])) ? null : UNSAFE), printenv: nothing,
  echo: nothing, printf: nothing, test: nothing, '[': (a) => (a.raw[a.raw.length - 1] === ']' ? null : UNSAFE),
  find: nothing, stat: nothing, file: simple({ badShort: 'C', badLong: ['--compile'] }), readlink: nothing, realpath: nothing, basename: nothing, dirname: nothing,
  journalctl: simple({ badShort: 'f', badLong: ['--vacuum-size', '--vacuum-time', '--vacuum-files', '--rotate', '--flush', '--sync', '--relinquish-var', '--smart-relinquish-var', '--setup-keys', '--update-catalog', '--follow', '--verify', '--interval', '--force', '--cursor-file'] }),
  systemctl: systemctlCheck, apt: aptCheck, 'apt-cache': aptCacheCheck, 'apt-get': aptGetCheck, dpkg: dpkgCheck,
  nvpmodel: (a) => (a.raw.length && only(['-q', '--query', '--verbose', '-v'])(a) === null && a.pos.length === 0 ? null : UNSAFE),
  jetson_clocks: (a) => (a.raw.length === 1 && a.raw[0] === '--show' ? null : UNSAFE),
  i2cdetect: (a) => (a.raw.length === 1 && a.raw[0] === '-l' ? null : UNSAFE),
  'v4l2-ctl': only(['--list-devices', '--device', '-d', '--list-formats', '--list-formats-ext', '--list-ctrls', '--list-ctrls-menus', '-L', '-l', '--all', '-D', '--info', '--get-fmt-video', '--get-parm', '--list-framesizes', '--list-frameintervals', '--get-ctrl'], ['-d', '--device']),
  ros2: ros2Check, awk: awkCheck, gawk: awkCheck, mawk: awkCheck, nawk: awkCheck, sed: sedCheck, git: gitCheck,
  dmesg: simple({ badShort: 'cCwWDEn', badLong: ['--clear', '--read-clear', '--follow', '--follow-new', '--console-off', '--console-on', '--console-level'] }),
  timedatectl: (a) => (a.pos.length === 0 || ['status', 'show', 'timesync-status', 'show-timesync', 'list-timezones'].includes(a.pos[0]) ? null : UNSAFE),
  hostnamectl: (a) => (a.pos.length === 0 || a.pos[0] === 'status' ? null : UNSAFE)
}

// ───────────── 스트림 전용 읽기 목록 (5.1.0) ─────────────
// analyze(cmd, { stream: true })에서만 READ_CMDS 대신(또는 더해서) 쓴다. 끝나지 않지만 읽기만 하는 명령.
// 항목을 더하려면 risk.test.mts에 "허용 사례 + 우회 사례" 한 쌍이 필요하다 (리뷰 강제)
const STREAM_ROS: Record<string, { ok: string[]; valued: string[] }> = {
  echo: { ok: ['--once', '--no-arr', '--no-str', '--full-length', '-f', '--csv', '--flow-style', '--no-daemon', '--use-sim-time', '--include-message-info', '-i', '--lost-messages', '--raw'], valued: ['--truncate-length', '--field', '--qos-profile', '--qos-depth', '--qos-history', '--qos-reliability', '--qos-durability'] },
  hz: { ok: ['--wall-time', '--no-daemon', '--use-sim-time'], valued: ['--window', '-w'] },
  bw: { ok: ['--no-daemon', '--use-sim-time'], valued: ['--window', '-w'] },
  delay: { ok: ['--no-daemon', '--use-sim-time'], valued: ['--window', '-w'] }
}
// ros2 topic echo|hz|bw|delay [옵션] 토픽 [타입]. --filter(Python 식 실행)·--ros-args·파일 옵션은 목록에 없으므로 읽기 아님
const ros2StreamCheck = (a: Args): Verdict => {
  const pos: string[] = []
  let verb: string | undefined
  let spec: { ok: string[]; valued: string[] } | undefined
  for (let k = 0; k < a.raw.length; k++) {
    const x = a.raw[k]
    if (x === '--') {
      pos.push(...a.raw.slice(k + 1))
      break
    }
    if (x.startsWith('-') && x.length > 1) {
      if (pos[0] !== 'topic' || !spec) return ros2Check(a) // 아직 하위 명령을 모름 → 5.0.0 규칙
      const name = x.startsWith('--') ? x.split('=')[0] : x
      if (spec.valued.includes(name)) {
        if (!x.includes('=')) k++
      } else if (!spec.ok.includes(name)) return UNSAFE
    } else {
      pos.push(x)
      if (pos.length === 2 && pos[0] === 'topic' && Object.hasOwn(STREAM_ROS, pos[1])) (verb = pos[1], (spec = STREAM_ROS[pos[1]]))
    }
  }
  if (!verb || !spec) return ros2Check(a)
  return pos.length >= 3 && pos.length <= 4 ? null : UNSAFE // 토픽 이름은 꼭 필요, 타입은 선택
}
const ipStream = (a: Args): Verdict => (a.raw[0] === 'monitor' ? (a.raw.slice(1).every((x) => ['all', 'link', 'address', 'route', 'neigh', 'rule', 'mroute', 'prefix', 'netconf', 'nsid'].includes(x)) ? null : UNSAFE) : ipCheck(a))
const udevStream = (a: Args): Verdict => (a.raw[0] === 'monitor' ? only(['--property', '-p', '--kernel', '-k', '--udev', '-u', '--environment', '-e'], ['--subsystem-match', '-s', '--tag-match', '-t'])(parseArgs(a.raw.slice(1))) : UNSAFE)
const STREAM_READ: Record<string, Check> = {
  journalctl: simple({ badLong: ['--vacuum-size', '--vacuum-time', '--vacuum-files', '--rotate', '--flush', '--sync', '--relinquish-var', '--smart-relinquish-var', '--setup-keys', '--update-catalog', '--verify', '--interval', '--force', '--cursor-file'] }), // -f·--follow 허용
  tail: simple({ badLong: ['--pid'] }), // -f -F --follow --retry 허용 (--pid는 다른 프로세스 상태를 봄)
  dmesg: simple({ badShort: 'cCDEn', badLong: ['--clear', '--read-clear', '--console-off', '--console-on', '--console-level'] }), // -w -W --follow 허용
  top: (a) => (a.short.includes('b') && a.pos.every((p) => /^[\w%+.,-]+$/.test(p)) ? simple({ badShort: 'k' })(a) : UNSAFE), // -b 없이는 화면을 점유함, -n 없이도 허용(반복)
  iostat: simple({ maxPos: 3 }), mpstat: simple({ maxPos: 3 }),
  tegrastats: (a) => (a.raw.length === 0 || (a.raw.length === 2 && a.raw[0] === '--interval' && /^\d{1,6}$/.test(a.raw[1])) ? null : UNSAFE),
  ros2: ros2StreamCheck, ip: ipStream, udevadm: udevStream
}

// 이름 자체가 위험한 명령
const DANGER_CMDS: Record<Reason, string[]> = {
  delete: ['rm', 'rmdir', 'shred', 'unlink', 'wipefs', 'srm'],
  disk: ['dd', 'mkfs', 'fdisk', 'sfdisk', 'cfdisk', 'parted', 'gdisk', 'mkswap', 'swapon', 'swapoff', 'mount', 'umount', 'losetup', 'fsck', 'e2fsck', 'resize2fs', 'tune2fs', 'blkdiscard'],
  power: ['reboot', 'shutdown', 'poweroff', 'halt', 'init', 'telinit'],
  privilege: ['sudo', 'su', 'doas', 'pkexec', 'chroot', 'nsenter', 'unshare', 'runuser', 'setpriv'],
  shell: ['sh', 'bash', 'dash', 'zsh', 'ksh', 'csh', 'tcsh', 'fish', 'ash', 'busybox', 'eval', 'exec', 'source', '.'],
  network: ['curl', 'wget', 'nc', 'ncat', 'netcat', 'socat', 'telnet', 'ssh', 'scp', 'sftp', 'rsync', 'ftp', 'tftp', 'lftp', 'aria2c', 'openssl', 'nmap', 'ping', 'ping6', 'traceroute', 'tracepath', 'dig', 'nslookup', 'host', 'mtr', 'ssh-keyscan', 'ssh-copy-id', 'sshpass', 'mosh', 'rclone', 'aws', 'gcloud', 'az', 'gh', 'mosquitto_pub', 'mosquitto_sub', 'mail', 'mailx', 'sendmail', 'msmtp', 'ssmtp', 'mutt'],
  users: ['passwd', 'chpasswd', 'useradd', 'userdel', 'usermod', 'groupadd', 'groupdel', 'groupmod', 'adduser', 'deluser', 'visudo', 'chage'],
  system: ['crontab', 'at', 'batch', 'iptables', 'ip6tables', 'nft', 'ufw', 'firewall-cmd', 'modprobe', 'insmod', 'rmmod', 'depmod', 'update-grub', 'grub-install', 'update-initramfs', 'dpkg-reconfigure', 'systemd-run'],
  package: [], sensitive: [], overwrite: [], write: [], unknown: [], unsafe: [], dynamic: [], syntax: [], redirect: [], newline: [], background: [], assign: [], input: []
}
const DANGER_BY_NAME = new Map<string, Reason>()
for (const [reason, names] of Object.entries(DANGER_CMDS) as [Reason, string[]][]) for (const n of names) DANGER_BY_NAME.set(n, reason)
// 패키지 관리자: 설치·삭제 하위 명령이면 danger
const PKG_MANAGERS: Record<string, string[]> = {
  pip: ['install', 'uninstall'], pip3: ['install', 'uninstall'], npm: ['install', 'i', 'uninstall', 'remove', 'update', 'publish'], snap: ['install', 'remove', 'refresh'], gem: ['install', 'uninstall'], cargo: ['install', 'uninstall'], conda: ['install', 'remove', 'update'], pipx: ['install', 'uninstall'], yarn: ['add', 'remove']
}
// 다른 명령을 실행하는 말이 섞였는지 볼 때 쓰는 이름 (읽기 허용 목록 밖 명령의 모든 단어를 훑음)
const SCAN_NAMES = new Set(['rm', 'rmdir', 'shred', 'unlink', 'dd', 'mkfs', 'wipefs', 'fdisk', 'parted', 'reboot', 'shutdown', 'poweroff', 'halt', 'sudo', 'su', 'doas', 'curl', 'wget', 'nc', 'ncat', 'netcat', 'socat', 'ssh', 'scp', 'rsync', 'telnet', 'eval', 'sh', 'bash', 'dash', 'zsh', 'ksh'])

// 이름 정리: 경로를 떼고 mkfs.ext4 → mkfs, python3.11 같은 버전 꼬리는 그대로 둠
function commandName(head: string): { name: string; pathy: boolean } | null {
  if (!head.includes('/')) return { name: head.startsWith('mkfs.') ? 'mkfs' : head.startsWith('fsck.') ? 'fsck' : head, pathy: false }
  const m = head.match(/^\/(?:usr\/)?(?:local\/)?(?:s?bin)\/([^/]+)$/)
  if (m) return { name: m[1].startsWith('mkfs.') ? 'mkfs' : m[1], pathy: m[1] === 'git' } // /usr/bin/git 는 앱이 git 앞에 씌우는 보호 함수(packrun)를 지나지 않으므로 읽기로 안 믿음
  return { name: head.slice(head.lastIndexOf('/') + 1), pathy: true } // ./rm ~/bin/ls : 경로 명령은 읽기로 못 믿음
}

class Acc {
  risk: Risk = 'read'
  reasons: Reason[] = []
  n = 0
  stream: boolean // 스트림 전용 읽기 목록(STREAM_READ)도 인정
  constructor(stream = false) {
    this.stream = stream
  }
  add(r: Risk, why: Reason): void {
    this.risk = maxRisk(this.risk, r)
    if (!this.reasons.includes(why)) this.reasons.push(why)
  }
}
const FLAG_RISK: Record<string, Risk> = { syntax: 'change', newline: 'change', background: 'change', redirect: 'change' }
const RUNS_OTHERS = new Set(['env', 'awk', 'gawk', 'mawk', 'nawk', 'sed', 'find'])
const DYN_OK = new Set(['echo', 'printf', 'test', '['])

function checkRedirect(r: Redir, acc: Acc): void {
  const t = r.target
  const lit = t && !t.dyn && !t.glob ? t.text : null
  if (['>', '>>', '&>', '&>>', '>|', '<>'].includes(r.op) && lit === '/dev/null') return
  if (['>&', '<&'].includes(r.op) && lit !== null && /^(\d+|-)$/.test(lit)) return
  if (t && (t.dyn || t.glob)) acc.add('danger', 'dynamic')
  if (['>', '&>', '>|', '>&'].includes(r.op)) acc.add('danger', 'overwrite')
  else if (['>>', '&>>', '<>'].includes(r.op)) acc.add('change', 'write')
  else acc.add('change', 'redirect')
  if (t) {
    if (/\/dev\/(tcp|udp)\//.test(t.text)) acc.add('danger', 'network')
    if (sensitiveWord(t)) acc.add('danger', 'sensitive')
    if (r.op.includes('>') && !t.dyn && !t.glob && isBlockedPath(normPath(t.text))) acc.add('danger', 'system') // /etc 같은 시스템 경로에 씀
  }
}

function analyzeCmd(cmd: Cmd, acc: Acc, depth: number): void {
  if (++acc.n > MAX_CMDS) {
    acc.add('change', 'syntax')
    return
  }
  for (const w of cmd.words) for (const s of w.subs) analyzeScript(s, acc, depth + 1)
  for (const r of cmd.redirs) {
    if (r.target) for (const s of r.target.subs) analyzeScript(s, acc, depth + 1)
    checkRedirect(r, acc)
  }
  let words = cmd.words
  let k = 0
  while (k < words.length && !words[k].dyn && /^[A-Za-z_]\w*=/.test(words[k].text)) {
    acc.add('change', 'assign') // FOO=bar cmd — LD_PRELOAD·PATH 같은 환경 바꿔치기
    k++
  }
  words = words.slice(k)
  if (!words.length) return
  for (const w of words) {
    if (/\/dev\/(tcp|udp)\//.test(w.text)) acc.add('danger', 'network')
    if (sensitiveWord(w)) acc.add('danger', 'sensitive')
  }
  const head = words[0]
  if (head.dyn || (head.glob && head.text !== '[')) { // '[' 는 test 명령 이름
    acc.add('change', 'dynamic')
    scanWords(words, acc)
    return
  }
  const cn = commandName(head.text)!
  const name = cn.name
  const args = words.slice(1)
  const reason = DANGER_BY_NAME.get(name)
  if (reason) {
    if (name === 'shutdown' && args[0]?.text === '-c') acc.add('change', 'write') // 예약 취소
    else acc.add('danger', reason)
    return
  }
  const pm = PKG_MANAGERS[name]
  if (pm) {
    const sub = args.find((w) => !w.text.startsWith('-'))
    if (sub && pm.includes(sub.text)) acc.add('danger', 'package')
    else acc.add('change', 'unknown')
    scanWords(words, acc)
    return
  }
  const check = acc.stream && Object.hasOwn(STREAM_READ, name) ? STREAM_READ[name] : Object.hasOwn(READ_CMDS, name) ? READ_CMDS[name] : undefined
  if (!check || cn.pathy) {
    acc.add('change', 'unknown')
    scanWords(words, acc)
    return
  }
  if (!DYN_OK.has(name) && args.some((w) => w.dyn)) {
    acc.add('change', 'dynamic')
    scanWords(words, acc)
    return
  }
  const a = parseArgs(args.map((w) => w.text))
  const v = check(a)
  if (v) {
    acc.add(v[0], v[1])
    if (v[0] === 'change' && RUNS_OTHERS.has(name)) scanWords(words, acc) // 다른 명령을 실행시킬 수 있는 것만 (systemctl restart ssh 의 ssh는 서비스 이름)
  }
  // 파일 내용을 재귀로 읽는 명령이 홈·루트처럼 넓은 곳을 가리키면 비밀 파일까지 읽게 됨
  if ((name === 'grep' || name === 'egrep' || name === 'fgrep') && (a.short.includes('r') || a.short.includes('R') || a.long.some((l) => '--recursive'.startsWith(l) && l.length > 2) || a.raw.some((x) => /^(-d|--directories=)recurse$/.test(x)) || a.raw.join(' ').includes('-d recurse'))) {
    const targets = a.pos.slice(1)
    if (!targets.length || targets.some((t) => ['.', '..', '', '~', '/'].includes(normPath(t)) || /^\/(home|root|etc|proc|sys|dev|var|opt)?$/.test(normPath(t)) || /^\/home\/[^/]+$/.test(normPath(t)))) acc.add('danger', 'sensitive')
  }
  if (name === 'find') {
    const rest = args.map((w) => w.text)
    if (rest.some((x) => ['-delete'].includes(x))) acc.add('danger', 'delete')
    else if (rest.some((x) => ['-exec', '-execdir', '-ok', '-okdir'].includes(x))) (acc.add('change', 'shell'), scanWords(words, acc))
    else if (rest.some((x) => ['-fprint', '-fprint0', '-fprintf', '-fls'].includes(x))) acc.add('change', 'write')
  }
}

// 읽기 허용 목록 밖 명령: 단어 안에 위험한 이름이 숨어 있으면 danger로 올림 (sh -c 'rm …', nohup rm …)
function scanWords(words: Word[], acc: Acc): void {
  for (const w of words) for (const tok of w.text.split(/[\s;&|()`$<>=\/]+/)) if (SCAN_NAMES.has(tok)) acc.add('danger', DANGER_BY_NAME.get(tok) ?? 'shell')
}

function analyzeScript(sc: Script, acc: Acc, depth: number): void {
  for (const f of sc.flags) acc.add(FLAG_RISK[f] ?? 'change', f)
  for (const c of sc.cmds) analyzeCmd(c, acc, depth)
}

// 명령 하나를 분석해서 앱이 계산한 위험도와 이유를 돌려줌 (읽기로 증명되면 read)
export function analyze(cmd: string, opts: AnalyzeOpts = {}): Analysis {
  const acc = new Acc(opts.stream === true)
  if (cmd.length > MAX_LEN) acc.add('change', 'syntax')
  else analyzeScript(parseScript(cmd, 0, false, 0).script, acc, 0)
  return { risk: acc.risk, reasons: acc.reasons }
}

// 실질 위험도 = max(팩이 적은 값, 앱이 계산한 값) — 내려갈 수 없음. understated: 팩이 계산보다 낮게 적음(⚠ 표시 대상)
export function effectiveRisk(declared: Risk, cmd: string, opts: { sudo?: boolean } = {}): { risk: Risk; computed: Risk; understated: boolean; reasons: Reason[] } {
  const a = analyze(cmd)
  let risk = maxRisk(declared, a.risk)
  if (opts.sudo) risk = maxRisk(risk, 'change') // sudo 필드는 바꾸는 항목에서만 가능
  return { risk, computed: a.risk, understated: RANK[a.risk] > RANK[declared], reasons: a.reasons }
}

// ───────────── 입력 슬롯 (5.1.0) ─────────────
// 입력 폼의 {이름} 자리. 앱이 값을 작은따옴표로 감싸 "글자 하나"로 넣으므로 템플릿에서는 맨 단어 자리에만 쓸 수 있다.
// 로드 때 slotProblem으로 위치를 검사하고, 실행 직전에는 값을 채운 명령 전체를 analyzeWithInput으로 다시 분석한다
const SLOT = /\{(\w+)\}/g
const SLOT_MARK = 'JDSLOT'
// 다른 명령을 실행하거나 코드를 해석하는 명령: 슬롯을 인자로도 받을 수 없음
const SLOT_FORBIDDEN_HEADS = new Set([...DANGER_CMDS.shell, 'xargs', 'nohup', 'timeout', 'nice', 'ionice', 'watch', 'stdbuf', 'setsid', 'script', 'python', 'python3', 'perl', 'ruby', 'node', 'php', 'lua', 'env', 'command', 'builtin', 'time', 'tee', 'parallel'])

// 템플릿에서 {이름}이 따옴표·역슬래시 밖에 있는지 (글자 하나씩 따옴표 상태를 따라감)
function slotsOutsideQuotes(t: string): boolean {
  let q: '' | "'" | '"' = ''
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q === "'") {
      if (c === "'") q = ''
      else if (c === '{' && /^\{\w+\}/.test(t.slice(i))) return false
    } else if (c === '\\') {
      if (t[i + 1] === '{') return false
      i++
    } else if (q === '"') {
      if (c === '"') q = ''
      else if (c === '{' && /^\{\w+\}/.test(t.slice(i))) return false
    } else if (c === "'" || c === '"') q = c
  }
  return true
}
function walkWords(sc: Script, inSub: boolean, visit: (w: Word, cmd: Cmd, index: number, inSub: boolean, redirTarget: boolean) => void): void {
  for (const cmd of sc.cmds) {
    cmd.words.forEach((w, k) => {
      visit(w, cmd, k, inSub, false)
      for (const s of w.subs) walkWords(s, true, visit)
    })
    for (const r of cmd.redirs) if (r.target) {
      visit(r.target, cmd, -1, inSub, true)
      for (const s of r.target.subs) walkWords(s, true, visit)
    }
  }
}
// 슬롯 자리 검사. 문제가 없으면 null, 있으면 사유(한국어 고정 문장). 템플릿에 슬롯이 없으면 null
export function slotProblem(template: string): string | null {
  if (!/\{\w+\}/.test(template)) return null
  if (!slotsOutsideQuotes(template)) return '입력 자리 {이름}은 따옴표 안에 쓸 수 없어요 (앱이 값을 따옴표로 감싸요)'
  const probe = template.replace(SLOT, (_m, n: string) => SLOT_MARK + n)
  const sc = parseScript(probe.slice(0, MAX_LEN), 0, false, 0).script
  let problem: string | null = null
  walkWords(sc, false, (w, cmd, k, inSub, redir) => {
    if (problem || !w.text.includes(SLOT_MARK)) return
    if (inSub) problem = '입력 자리 {이름}은 $( )·백틱·<( ) 안에 쓸 수 없어요'
    else if (redir) problem = '입력 자리 {이름}은 리다이렉트 대상에 쓸 수 없어요'
    else if (k === 0) problem = '입력 자리 {이름}은 명령 이름 자리에 쓸 수 없어요'
    else {
      const head = commandName(cmd.words[0].text)
      if (!head || SLOT_FORBIDDEN_HEADS.has(head.name) || head.pathy) problem = '입력 자리 {이름}은 다른 명령을 실행하는 명령의 인자로 쓸 수 없어요'
      else if (w.dyn && !new RegExp('^[^$`]*' + SLOT_MARK).test(w.text)) problem = '입력 자리 {이름}이 값이 실행 때 정해지는 글자와 섞여 있어요'
    }
  })
  return problem
}

// 실행 직전 재분석: 값을 채운 명령의 분석 결과를 로드 때 계산한 값(정적, 대표 값 기준)과 합침. 입력 값 때문에 올라갔으면 escalated + 이유 'input'
export function analyzeWithInput(filled: string, staticResult: Analysis, opts: AnalyzeOpts = {}): { risk: Risk; reasons: Reason[]; escalated: boolean } {
  const now = analyze(filled, opts)
  const escalated = RANK[now.risk] > RANK[staticResult.risk]
  const reasons = [...staticResult.reasons]
  for (const r of now.reasons) if (!reasons.includes(r)) reasons.push(r)
  if (escalated && !reasons.includes('input')) reasons.unshift('input')
  return { risk: maxRisk(staticResult.risk, now.risk), reasons, escalated }
}

// ───────────── 막힌 경로 ─────────────
const DESTROYERS = new Set(['rm', 'rmdir', 'shred', 'unlink', 'truncate', 'dd', 'mkfs', 'wipefs', 'srm'])
function collectCmds(sc: Script, out: Cmd[]): void {
  for (const c of sc.cmds) {
    out.push(c)
    for (const w of c.words) for (const s of w.subs) collectCmds(s, out)
    for (const r of c.redirs) for (const s of r.target?.subs ?? []) collectCmds(s, out)
  }
}
// 지우는 명령(rm·dd·mkfs·find -delete 등)이 막힌 경로나 실행 때 정해지는 대상을 가리키면 그 경로(글자)를, 괜찮으면 null
export function destroysBlockedPath(cmd: string): string | null {
  const cmds: Cmd[] = []
  collectCmds(parseScript(cmd.slice(0, MAX_LEN), 0, false, 0).script, cmds)
  for (const c of cmds) {
    if (!c.words.length) continue
    const head = commandName(c.words[0].text)
    if (!head) continue
    const args = c.words.slice(1)
    const isFindDelete = head.name === 'find' && args.some((w) => w.text === '-delete')
    if (!DESTROYERS.has(head.name) && !isFindDelete) continue
    for (const w of args) {
      if (isFindDelete) {
        if (w.text.startsWith('-') || w.text === '(' || w.text === '!') break // 시작 경로는 옵션 앞에만
      } else if (w.text.startsWith('-') && !/^of=/.test(w.text)) continue
      const target: Word | null = head.name === 'dd' ? (w.text.startsWith('of=') ? { ...w, text: w.text.slice(3) } : null) : w // dd는 of= 만 대상
      if (!target) continue
      const b = blockedWord(target)
      if (b) return b
    }
  }
  return null
}
