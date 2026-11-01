// 시험용 가짜 Device 파일 시스템 (메모리). 심볼릭 링크·FIFO·큰 파일 같은 나쁜 상황을 직접 만들어 넣는다. 앱 코드에서는 쓰지 않음
import type { FsStat, PathFs } from './permpath.mts'

type Node = { kind: 'file' | 'dir' | 'link' | 'other'; size: number; data?: Buffer; target?: string }

export class FakeDevice implements PathFs {
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
}
