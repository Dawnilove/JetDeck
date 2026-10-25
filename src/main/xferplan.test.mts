import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapLimit, MAX_FILES, planTree, type TreeNode } from './xferplan.mts'

const tree: Record<string, TreeNode[]> = {
  '/p': [
    { name: 'a.txt', dir: false, size: 3 },
    { name: 'sub', dir: true, size: 0 },
    { name: 'empty', dir: true, size: 0 }
  ],
  '/p/sub': [{ name: 'b:c.txt', dir: false, size: 5 }],
  '/p/empty': []
}
const join = (d: string, n: string) => `${d}/${n}`

test('폴더 트리 → 파일 작업 + 만들 폴더 (빈 폴더도, 받는 쪽 이름 고침)', async () => {
  const r = await planTree(async (d) => tree[d] ?? [], join, join, '/p', 'C:/out/p', 'p', (n) => n.replace(/:/g, '_'))
  assert.deepEqual(r.dirs, ['C:/out/p', 'C:/out/p/sub', 'C:/out/p/empty'])
  assert.deepEqual(r.files.map((f) => [f.src, f.dstDir, f.name, f.label]), [
    ['/p/a.txt', 'C:/out/p', 'a.txt', 'p/a.txt'],
    ['/p/sub/b:c.txt', 'C:/out/p/sub', 'b_c.txt', 'p/sub/b_c.txt']
  ])
})

test('파일이 너무 많으면 거부', async () => {
  const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => ({ name: `f${i}`, dir: false, size: 1 }))
  await assert.rejects(planTree(async () => many, join, join, '/p', '/q', 'p'), /넘어요/)
})

test('mapLimit: 동시에 n개까지만, 결과는 입력 순서', async () => {
  let now = 0
  let peak = 0
  const r = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (x) => {
    peak = Math.max(peak, ++now)
    await new Promise((res) => setTimeout(res, 5))
    now--
    return x * 2
  })
  assert.deepEqual(r, [2, 4, 6, 8, 10, 12])
  assert.equal(peak, 2)
  assert.deepEqual(await mapLimit([], 3, async (x) => x), [])
})
