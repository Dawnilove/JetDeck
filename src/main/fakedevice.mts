// 시험용 가짜 Device 파일 시스템 (메모리). 심볼릭 링크·FIFO·큰 파일 같은 나쁜 상황을 직접 만들어 넣는다. 앱 코드에서는 쓰지 않음
import { Readable, Writable } from 'node:stream'
import type { DeviceFs } from './packappcore.mts'
import type { FsKind, FsStat } from './permpath.mts'

type Node ={ kind: 'file' | 'dir' | 'link' | 'other'; size: number; data?: Buffer; target?: string }

export class FakeDevice implements DeviceFs {
  nodes = new Map<string, Node>([['/', { kind: 'dir', size: 0 }]])
  home: string
  constructor(home = '/home/u') {
    this.home = home
    this.mkdir(home)
  }
  private abs = (p: string) => (p === '.' ? this.home : p.startsWith('/') ? p : `${this.home}/${p}`)
  mkdir(p: string): this {
    const parts = p.split('/').filter(Boolean)
    let cur = ''
    for (const x of parts) {
      cur += '/' + x
      if (!this.nodes.has(cur)) this.nodes.set(cur, { kind: 'dir', size: 0 })
    }
    return this
  }
  file(p: string, data: string | number | Buffer = ''): this {
    this.mkdir(p.slice(0, p.lastIndexOf('/')))
    const buf = typeof data === 'number' ? undefined : Buffer.from(data)
    this.nodes.set(p, { kind: 'file', size: typeof data === 'number' ? data : buf!.length, data: buf })
    return this
  }
  link(p: string, target: string): this {
    this.mkdir(p.slice(0, p.lastIndexOf('/')))
    this.nodes.set(p, { kind: 'link', size: 0, target })
    return this
  }
  other(p: string): this {
    this.mkdir(p.slice(0, p.lastIndexOf('/')))
    this.nodes.set(p, { kind: 'other', size: 0 })
    return this
  }
  // 경로를 한 칸씩 걸으며 링크를 풀어 실제 경로를 얻음. 중간이 없으면 null, 마지막만 없으면 node null
  private walk(p: string, followLast: boolean, depth = 0): { path: string; node: Node | null } | null {
    if (depth > 40) throw new Error('too many links')
    const parts = this.abs(p).split('/').filter(Boolean)
    let cur = ''
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1
      cur += '/' + parts[i]
      const node = this.nodes.get(cur)
      if (!node) return last ? { path: cur, node: null } : null
      if (node.kind === 'link' && (!last || followLast)) {
        const t = this.walk(node.target!, true, depth + 1)
        if (!t?.node) return last && !followLast ? { path: cur, node } : null // 끊어진 링크
        cur = t.path
      } else if (!last && node.kind !== 'dir') return null
    }
    return { path: cur || '/', node: this.nodes.get(cur || '/') ?? null }
  }
  async realpath(p: string): Promise<string> {
    const w = this.walk(p, true)
    if (!w?.node) throw new Error('No such file')
    return w.path
  }
  private st = (n: Node | null | undefined): FsStat | null => (n ? { kind: n.kind, size: n.size } : null)
  async stat(p: string): Promise<FsStat | null> {
    return this.st(this.walk(p, true)?.node)
  }
  async lstat(p: string): Promise<FsStat | null> {
    return this.st(this.walk(p, false)?.node)
  }

  // ── 전송용 (DeviceFs). cutAfter: 이 바이트만큼 흐른 뒤 연결이 끊긴 것처럼 실패 ──
  cutAfter: number | null = null
  stall = false
  extra = 0 // stat이 알려 준 크기보다 더 많이 흐르게 함 (실행 중 커지는 파일)
  modes = new Map<string, number>()
  async readdir(p: string): Promise<{ name: string; kind: FsKind; size: number }[]> {
    const w = this.walk(p, true)
    if (w?.node?.kind !== 'dir') throw new Error('Not a directory')
    const out: { name: string; kind: FsKind; size: number }[] = []
    for (const [k, n] of this.nodes) if (k !== w.path && k.startsWith((w.path === '/' ? '' : w.path) + '/') && !k.slice(w.path.length + 1).includes('/')) out.push({ name: k.slice(k.lastIndexOf('/') + 1), kind: n.kind, size: n.size })
    return out
  }
  readStream(p: string): Readable {
    const n = this.walk(p, true)?.node
    if (n?.kind !== 'file') throw new Error('No such file')
    const cut = this.cutAfter
    const dev = this
    let sent = 0
    return new Readable({
      read() {
        if (dev.stall) return // 멈춰 있는 연결 (취소·시간 초과 시험)
        if (cut !== null && sent >= cut) return this.destroy(new Error('Connection lost'))
        if (sent >= n.size + dev.extra) return void this.push(null)
        const len = Math.min(65536, n.size + dev.extra - sent, cut === null ? Infinity : cut - sent)
        this.push(n.data ? n.data.subarray(sent, sent + len) : Buffer.alloc(len))
        sent += len
      }
    })
  }
  writeStream(p: string, mode: number): Writable {
    const self = this
    const chunks: Buffer[] = []
    let got = 0
    return new Writable({
      construct(cb) {
        cb(self.nodes.has(p) ? new Error('File exists') : null) // wx
      },
      write(c: Buffer, _e, cb) {
        got += c.length
        chunks.push(c)
        if (self.cutAfter !== null && got > self.cutAfter) {
          self.nodes.set(p, { kind: 'file', size: got, data: Buffer.concat(chunks) }) // 끊겨도 임시 파일은 남음
          return cb(new Error('Connection lost'))
        }
        cb()
      },
      final(cb) {
        const data = Buffer.concat(chunks)
        self.nodes.set(p, { kind: 'file', size: data.length, data })
        self.modes.set(p, mode)
        cb()
      }
    })
  }
  async rename(from: string, to: string, overwrite: boolean): Promise<void> {
    const n = this.nodes.get(from)
    if (!n) throw new Error('No such file')
    if (!overwrite && this.nodes.has(to)) throw new Error('File exists')
    this.nodes.delete(from)
    this.nodes.set(to, n)
    const m = this.modes.get(from)
    if (m !== undefined) (this.modes.delete(from), this.modes.set(to, m))
  }
  async unlink(p: string): Promise<void> {
    if (!this.nodes.delete(p)) throw new Error('No such file')
  }
  read(p: string): string | undefined {
    return this.nodes.get(p)?.data?.toString()
  }
  names(dir: string): string[] {
    return [...this.nodes.keys()].filter((k) => k.startsWith(dir + '/') && !k.slice(dir.length + 1).includes('/')).map((k) => k.slice(dir.length + 1))
  }
}
