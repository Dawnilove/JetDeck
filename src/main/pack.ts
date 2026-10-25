import { ipcMain } from 'electron'
import { tr } from './i18n.mts'
import { run } from './monitor'
import deviceJson from './packs/device.json'
import { buildPreview, buildRun, parseResult, resolveParams, type PackResult } from './packrun.mts'
import { validatePack, type Pack, type PackAction } from './packschema.mts'
import { requireClient as client } from './session'

// 선언형 팩 실행 (4.5.0): 명령은 팩 데이터에 있고 화면은 id만 보냄. 설치·정리 항목은 미리보기를 한 뒤에만 실행됨. sudo는 sudo -n 먼저, 비밀번호가 필요하면 화면이 새 터미널로 넘김
const { pack, errors } = validatePack(deviceJson)
for (const e of errors) console.warn('[pack] 항목 제외:', e)
const packs: Pack[] = pack ? [pack] : []
const actions = new Map<string, PackAction>()
for (const p of packs) for (const pg of p.pages) for (const a of pg.actions) actions.set(a.id, a)
const previewed = new Map<string, number>() // `${connId}:${actionId}` → 미리보기 본 시각. 실행하면 지우고, 10분이 지나면 다시 봐야 함
const PREVIEW_TTL = 10 * 60_000

export function registerPackIpc(): void {
  ipcMain.handle('pack:list', (): Pack[] => packs)
  ipcMain.handle('pack:run', async (_e, connId: string, actionId: string, given: Record<string, string> | undefined, mode: 'run' | 'preview'): Promise<PackResult> => {
    const a = actions.get(String(actionId))
    if (!a) throw new Error(tr('알 수 없는 항목이에요'))
    const values = resolveParams(a, given ?? {})
    const key = `${connId}:${a.id}`
    if (mode === 'preview') {
      if (!a.preview) throw new Error(tr('미리보기가 없는 항목이에요'))
      const out = await run(client(connId), buildPreview(a, values))
      previewed.set(key, Date.now())
      return { ok: true, needPassword: false, text: out.replace(/__EXIT__\d+\s*$/, '').trim() }
    }
    if (a.preview && Date.now() - (previewed.get(key) ?? 0) > PREVIEW_TTL) throw new Error(tr('먼저 미리보기를 확인해야 실행할 수 있어요'))
    previewed.delete(key)
    const b = buildRun(a, values)
    return parseResult(a, await run(client(connId), b.command), b.termCmd)
  })
}
