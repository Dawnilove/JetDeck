import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tr } from './i18n.mts'
import { run } from './monitor'
import deviceJson from './packs/device.json'
import perfJson from './packs/perf.json'
import ros2Json from './packs/ros2.json'
import { sanitizeOutput } from './packsafe.mts'
import { buildPreview, buildRun, buildTerminal, parseResult, resolveParams, type PackResult } from './packrun.mts'
import { approveAndEnable, buildCatalog, enabledPacks, ensureDir, forgetPack, inspectPackBytes, installPackBytes, readState, readUserDir, setEnabled, writeState, type Inspect, type PackEntry, type StateFile } from './packstore.mts'
import type { Pack, PackAction } from './packschema.mts'
import { requireClient as client } from './session'

// 선언형 팩 (5.0.0): 명령은 팩 데이터(main)에 있고 화면은 packId/pluginId/actionId만 보냄. 외부 팩은 사용자가 허용한 파일 지문과 같을 때만 켜짐.
// 설치·정리 항목은 미리보기를 한 뒤에만 실행됨. sudo는 sudo -n 먼저, 비밀번호가 필요하면 화면이 새 터미널로 넘김
const OFFICIAL = [
  { fileName: 'device.json', raw: deviceJson as unknown },
  { fileName: 'ros2.json', raw: ros2Json as unknown },
  { fileName: 'perf.json', raw: perfJson as unknown }
]
const userDir = () => join(app.getPath('userData'), 'packs')
const stateFile = () => join(app.getPath('userData'), 'packs-state.json')
const safeMode = process.argv.includes('--safe-mode') // 문제 팩 때문에 앱이 이상할 때: 외부 팩을 전혀 읽지 않음

export type Catalog = { safeMode: boolean; userDir: string; entries: PackEntry[] }
let state: StateFile = { version: 1, packs: {} }
let entries: PackEntry[] = []
let pending: { bytes: Uint8Array; hash: string } | null = null // 설치하려고 고른 파일 (확인 창에서 보여 준 것과 같은 것만 설치)

const catalog = (): Catalog => ({ safeMode, userDir: userDir(), entries })
function rescan(): Catalog {
  state = readState(stateFile())
  entries = buildCatalog({ official: OFFICIAL, user: safeMode ? [] : readUserDir(userDir()), state, appVersion: app.getVersion() })
  for (const e of entries) for (const x of [...e.errors, ...e.warnings]) console.warn(`[pack] ${e.id}:`, x)
  return catalog()
}
const save = (st: StateFile) => {
  writeState(stateFile(), st)
  state = st
}
const entryOf = (id: string): PackEntry => {
  const e = entries.find((x) => x.id === String(id))
  if (!e) throw new Error(tr('알 수 없는 팩이에요'))
  return e
}
// 실행할 항목 찾기: 켜진 팩 안에서만, 숨겨진(이 앱이 모르는 방식) 항목은 못 씀
function find(packId: string, pluginId: string, actionId: string): { pack: Pack; action: PackAction } {
  const e = entryOf(packId)
  if (!e.enabled || !e.pack) throw new Error(tr('이 팩은 켜져 있지 않아요'))
  const a = e.pack.plugins.find((p) => p.id === String(pluginId))?.actions.find((x) => x.id === String(actionId))
  if (!a) throw new Error(tr('알 수 없는 항목이에요'))
  if (a.hidden) throw new Error(tr('이 항목은 이 앱 버전에서 쓸 수 없어요'))
  return { pack: e.pack, action: a }
}

const previewed = new Map<string, number>() // `${connId}:${팩/플러그인/항목}` → 미리보기 본 시각. 실행하면 지우고, 10분이 지나면 다시 봐야 함
const PREVIEW_TTL = 10 * 60_000
const inflight = new Map<string, Set<string>>() // 팩 id → 실행 중인 항목 (같은 항목 중복 금지, 팩당 동시 3개)
const MAX_INFLIGHT = 3

export function registerPackIpc(): void {
  rescan()
  // 켜진 팩 (4.5.0 호환: 팩 배열). 관리 화면용 전체 목록은 pack:catalog
  ipcMain.handle('pack:list', (): Pack[] => enabledPacks(entries))
  ipcMain.handle('pack:catalog', (): Catalog => catalog())
  ipcMain.handle('pack:rescan', (): Catalog => rescan())
  // 켜기·끄기. 외부 팩을 처음(또는 파일이 바뀐 뒤) 켤 때는 허용 창에서 사용자에게 보여 준 지문(shownHash)을 같이 보내야 함
  ipcMain.handle('pack:enable', (_e, packId: string, on: boolean, shownHash?: string): Catalog => {
    const e = entryOf(packId)
    if (on === true && e.source === 'user' && e.approval !== 'approved') save(approveAndEnable(state, e, String(shownHash ?? '')))
    else save(setEnabled(state, e, on === true))
    return rescan()
  })
  ipcMain.handle('pack:open-dir', async (): Promise<void> => {
    ensureDir(userDir())
    await shell.openPath(userDir())
  })
  // 설치: 대화상자(main)에서 파일 고르기 → 내용 확인 정보 반환(아무것도 복사하지 않음) → 확인하면 pack:install(지문)
  ipcMain.handle('pack:pick', async (e): Promise<Inspect | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { title: tr('팩 파일 고르기'), properties: ['openFile' as const], filters: [{ name: tr('JetDeck 팩'), extensions: ['json'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    const bytes = readFileSync(r.filePaths[0])
    const ins = inspectPackBytes(bytes, app.getVersion(), entries)
    pending = ins.ok ? { bytes, hash: ins.hash } : null
    return ins
  })
  ipcMain.handle('pack:install', (_e, hash: string): Catalog => {
    if (!pending) throw new Error(tr('설치할 팩을 먼저 골라 주세요'))
    if (pending.hash !== String(hash)) throw new Error(tr('고른 파일이 바뀌었어요. 다시 골라 주세요'))
    installPackBytes(userDir(), pending.bytes, app.getVersion(), entries)
    pending = null
    return rescan()
  })
  // 제거: 파일을 휴지통으로 (영구 삭제 아님). 공식 팩은 끌 수만 있음
  ipcMain.handle('pack:remove', async (_e, packId: string): Promise<Catalog> => {
    const e = entryOf(packId)
    if (e.source !== 'user' || !e.file) throw new Error(tr('공식 팩은 제거할 수 없어요 (끄기만 가능)'))
    await shell.trashItem(e.file)
    save(forgetPack(state, e.id))
    return rescan()
  })

  ipcMain.handle('pack:run', async (_e, connId: string, packId: string, pluginId: string, actionId: string, given: Record<string, string> | undefined, mode: 'run' | 'preview'): Promise<PackResult> => {
    const { pack, action: a } = find(packId, pluginId, actionId)
    if (a.mode !== 'exec') throw new Error(tr('이 항목은 터미널에 입력하는 항목이에요'))
    const values = resolveParams(a, given ?? {})
    const key = `${connId}:${pack.id}/${pluginId}/${a.id}`
    const running = inflight.get(pack.id) ?? new Set<string>()
    if (running.has(key)) throw new Error(tr('같은 항목이 이미 실행 중이에요'))
    if (running.size >= MAX_INFLIGHT) throw new Error(tr('이 팩은 동시에 3개까지만 실행할 수 있어요'))
    running.add(key)
    inflight.set(pack.id, running)
    try {
      if (mode === 'preview') {
        if (!a.preview) throw new Error(tr('미리보기가 없는 항목이에요'))
        const out = await run(client(connId), buildPreview(a, values))
        previewed.set(key, Date.now())
        return { ok: true, needPassword: false, text: sanitizeOutput(out.replace(/__EXIT__\d+\s*$/, '').trim()) }
      }
      if (a.preview && Date.now() - (previewed.get(key) ?? 0) > PREVIEW_TTL) throw new Error(tr('먼저 미리보기를 확인해야 실행할 수 있어요'))
      previewed.delete(key)
      const b = buildRun(a, values)
      return parseResult(a, await run(client(connId), b.command), b.termCmd)
    } finally {
      running.delete(key)
    }
  })
  // 터미널 입력 항목: 입력할 글자는 main이 팩에서 만들어 돌려줌 (화면이 명령을 끼워 넣을 길이 없음). 위험도·이유를 같이 줘서 화면이 입력 전에 확인창을 띄움
  ipcMain.handle('pack:terminal', (_e, packId: string, pluginId: string, actionId: string, given: Record<string, string> | undefined) => {
    const { action: a } = find(packId, pluginId, actionId)
    if (a.mode !== 'terminal') throw new Error(tr('이 항목은 터미널에 입력하는 항목이 아니에요'))
    return { ...buildTerminal(a, resolveParams(a, given ?? {})), risk: a.risk, reasons: a.reasons, understated: a.understated }
  })
}
