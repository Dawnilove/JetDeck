import { tr } from './i18n.mts'
// 폴더 전송 계획 (transfer.ts가 쓰는 순수 로직): 폴더 트리를 파일 작업 목록 + 만들 폴더 목록으로 펼침
export type TreeNode = { name: string; dir: boolean; size: number }
export type PlanFile = { src: string; dstDir: string; name: string; size: number; label: string }
export type Plan = { files: PlanFile[]; dirs: string[] } // dirs: 받는 쪽에 만들어 둘 폴더 (부모가 먼저)

export const MAX_FILES = 20000

// list: 폴더 하나의 내용 (내 PC / 젯슨 공용). fixName: 받는 쪽 이름에 못 쓰는 글자 바꾸기
export async function planTree(
  list: (dir: string) => Promise<TreeNode[]>,
  joinSrc: (dir: string, name: string) => string,
  joinDst: (dir: string, name: string) => string,
  src: string,
  dst: string,
  top: string,
  fixName: (n: string) => string = (n) => n
): Promise<Plan> {
  const plan: Plan = { files: [], dirs: [dst] }
  const stack = [{ src, dst, rel: top }]
  for (let cur = stack.pop(); cur; cur = stack.pop()) {
    const children = await list(cur.src)
    const subdirs: typeof stack = []
    for (const c of children) {
      const name = fixName(c.name)
      if (c.dir) {
        const d = joinDst(cur.dst, name)
        plan.dirs.push(d)
        subdirs.push({ src: joinSrc(cur.src, c.name), dst: d, rel: `${cur.rel}/${name}` })
      } else {
        if (plan.files.length >= MAX_FILES) throw new Error(tr('파일이 {0}개를 넘어요. 폴더를 나눠서 보내 주세요', MAX_FILES.toLocaleString()))
        plan.files.push({ src: joinSrc(cur.src, c.name), dstDir: cur.dst, name, size: c.size, label: `${cur.rel}/${name}` })
      }
    }
    stack.push(...subdirs.reverse()) // 이름순으로 깊이 우선
  }
  return plan
}

// 일을 최대 n개씩 동시에 (결과는 입력 순서). 하나가 실패해도 나머지는 계속하도록 fn이 직접 처리할 것
export async function mapLimit<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i], i)
      }
    })
  )
  return out
}
