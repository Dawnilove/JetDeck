import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tr } from './i18n.mts'
import { run } from './monitor'
import deviceJson from './packs/device.json'
import devtoolsJson from './packs/devtools.json'
import examplesJson from './packs/examples.json'
import perfJson from './packs/perf.json'
import ros2Json from './packs/ros2.json'
import ros2LiveJson from './packs/ros2live.json'
import { parseFromOutput } from './packfields.mts'
import { dropConn, runBadges } from './packbadge.mts'
import type { BadgeResult } from './packbadgecore.mts'
import { startPoll, stopAllPolls, stopPoll } from './packpoll.mts'
import { sanitizeOutput } from './packsafe.mts'
import { buildFrom, buildPoll, buildPreview, buildRun, buildStream, buildTerminal, fill, hasUnsafeMark, parseResult, resolveParams, unsafeNotice, type PackResult } from './packrun.mts'
import { startStream, stopAll, stopStream } from './packstream.mts'
import { approveAndEnable, buildCatalog, enabledPacks, ensureDir, forgetPack, inspectPackBytes, installPackBytes, readState, readUserDir, setBadgesOff, setEnabled, writeState, type Inspect, type PackEntry, type StateFile } from './packstore.mts'
import { LIMITS, type Pack, type PackAction, type Reason, type Risk } from './packschema.mts'
import { analyzeWithInput } from './risk.mts'
import { requireClient as client } from './session'

// 선언형 팩 (5.0.0): 명령은 팩 데이터(main)에 있고 화면은 packId/pluginId/actionId만 보냄. 외부 팩은 사용자가 허용한 파일 지문과 같을 때만 켜짐.
// 설치·정리 항목은 미리보기를 한 뒤에만 실행됨. sudo는 sudo -n 먼저, 비밀번호가 필요하면 화면이 새 터미널로 넘김
const OFFICIAL = [
  { fileName: 'device.json', raw: deviceJson as unknown },
  { fileName: 'ros2.json', raw: ros2Json as unknown },
  { fileName: 'ros2live.json', raw: ros2LiveJson as unknown }, // 기본 꺼짐(베타)
  { fileName: 'perf.json', raw: perfJson as unknown },
  { fileName: 'devtools.json', raw: devtoolsJson as unknown }, // 기본 꺼짐(베타), 탐색기 Git 배지
  { fileName: 'examples.json', raw: examplesJson as unknown } // 기본 꺼짐(packstore OFFICIAL_DEFAULT_OFF). 원본: docs/plugins/examples/
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

// 실행 직전 준비 (5.1.0): 입력 값을 검사해서 채운 명령과, 그 명령 전체를 다시 분석한 위험도를 돌려줌.
// 화면은 이 결과로 확인창을 띄우고, 확인을 받으면 token을 실행 요청에 같이 보냄 → main이 "확인한 명령 = 실행할 명령"인지 다시 검사함 (입력 폼·스트림 항목)
export type Prepared = { cmd: string; risk: Risk; reasons: Reason[]; escalated: boolean; understated: boolean; needConfirm: boolean; token: string }
function prepareAction(pack: Pack, pluginId: string, a: PackAction, values: Record<string, string>): Prepared {
  const cmd = fill(a.cmd, values)
  // 입력 필드가 없는 항목은 로드 때 계산한 값이 전부임 (공식 팩의 고정된 읽기 예외도 그대로 유지)
  const r = a.fields ? analyzeWithInput(cmd, { risk: a.risk, reasons: a.reasons }, { stream: a.mode === 'stream' }) : { risk: a.risk, reasons: a.reasons, escalated: false }
  const token = createHash('sha256').update(`${pack.id}/${pluginId}/${a.id}\0${a.mode}\0${cmd}`).digest('hex').slice(0, 32)
  return { cmd, risk: r.risk, reasons: r.reasons, escalated: r.escalated, understated: a.understated, needConfirm: r.risk !== 'read', token }
}
// 확인이 필요한 실행인데 확인한 명령과 다르거나 확인 없이 왔으면 거부 (스트림·입력 폼 항목)
function requireConfirmed(a: PackAction, p: Prepared, token: unknown): void {
  if ((a.mode === 'stream' || a.fields) && p.needConfirm && token !== p.token) throw new Error(tr('확인한 명령과 달라요. 다시 확인해 주세요'))
}

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

  ipcMain.handle('pack:run', async (_e, connId: string, packId: string, pluginId: string, actionId: string, given: Record<string, string> | undefined, mode: 'run' | 'preview', token?: string): Promise<PackResult> => {
    const { pack, action: a } = find(packId, pluginId, actionId)
    if (a.mode !== 'exec') throw new Error(tr('이 항목은 터미널에 입력하는 항목이에요'))
    const values = resolveParams(a, given ?? {})
    if (mode === 'run') requireConfirmed(a, prepareAction(pack, pluginId, a, values), token)
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
        if (hasUnsafeMark(out)) return { ok: false, needPassword: false, text: unsafeNotice() } // 미리보기가 안 됐으니 실행도 못 함
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
    const { pack, action: a } = find(packId, pluginId, actionId)
    if (a.mode !== 'terminal') throw new Error(tr('이 항목은 터미널에 입력하는 항목이 아니에요'))
    const values = resolveParams(a, given ?? {})
    const p = prepareAction(pack, pluginId, a, values) // 입력 값이 위험도를 올렸으면 그 값을 돌려줌
    return { ...buildTerminal(a, values), risk: p.risk, reasons: p.reasons, understated: a.understated }
  })
  // 실행 전 준비: 값 검사 + 채운 명령 + 다시 분석한 위험도 + 확인 토큰
  ipcMain.handle('pack:prepare', (_e, packId: string, pluginId: string, actionId: string, given: Record<string, string> | undefined): Prepared => {
    const { pack, action: a } = find(packId, pluginId, actionId)
    return prepareAction(pack, pluginId, a, resolveParams(a, given ?? {}))
  })
  // 흐르는 출력: 시작은 확인(필요하면)을 거친 뒤. 멈춤·화면 이탈·연결 끊김·앱 종료는 packstream이 Device 프로세스까지 정리
  ipcMain.handle('pack:stream-start', (e, connId: string, packId: string, pluginId: string, actionId: string, given: Record<string, string> | undefined, streamId: string, token?: string): Promise<void> => {
    const { pack, action: a } = find(packId, pluginId, actionId)
    if (a.mode !== 'stream') throw new Error(tr('이 항목은 실시간으로 보는 항목이 아니에요'))
    if (!/^[\w-]{1,64}$/.test(String(streamId))) throw new Error(tr('올바르지 않은 요청이에요'))
    const values = resolveParams(a, given ?? {})
    requireConfirmed(a, prepareAction(pack, pluginId, a, values), token)
    return startStream(e.sender, client(connId), String(streamId), pack.id, buildStream(a, values), a.timeout ?? LIMITS.timeoutStreamDefault, a.stopGrace)
  })
  ipcMain.handle('pack:stream-stop', (_e, streamId: string): void => stopStream(String(streamId)))
  // 동적 선택지(select의 from): 읽기로 증명된 목록 명령을 실행해 줄마다 글자 종류를 검사한 값만 돌려줌
  ipcMain.handle('pack:from', async (_e, connId: string, packId: string, pluginId: string, actionId: string, fieldName: string): Promise<string[]> => {
    const { pack, action: a } = find(packId, pluginId, actionId)
    const f = a.fields?.find((x) => x.name === String(fieldName))
    if (!f || f.type !== 'select' || !f.from) throw new Error(tr('목록을 불러올 수 없는 항목이에요'))
    const key = `${connId}:${pack.id}/${pluginId}/${a.id}#${f.name}`
    const running = inflight.get(pack.id) ?? new Set<string>()
    if (running.has(key)) throw new Error(tr('같은 항목이 이미 실행 중이에요'))
    if (running.size >= MAX_INFLIGHT) throw new Error(tr('이 팩은 동시에 3개까지만 실행할 수 있어요'))
    running.add(key)
    inflight.set(pack.id, running)
    try {
      const out = sanitizeOutput(await run(client(connId), buildFrom(f.from)))
      if (hasUnsafeMark(out)) throw new Error(unsafeNotice()) // 표식 글자가 선택지로 보이지 않게
      return parseFromOutput(f.from, out)
    } finally {
      running.delete(key)
    }
  })
  // 그래프(5.2.0): 읽기 명령을 every초마다 main이 실행해 점을 보냄. 멈춤·화면 이탈·연결 끊김·연속 실패는 packpoll이 정리
  ipcMain.handle('pack:poll-start', (e, connId: string, packId: string, pluginId: string, actionId: string, pollId: string): void => {
    const { pack, action: a } = find(packId, pluginId, actionId)
    const d = a.display
    if (a.mode !== 'exec' || d?.type !== 'chart') throw new Error(tr('이 항목은 그래프 항목이 아니에요'))
    if (a.risk !== 'read' || a.computed !== 'read' || a.sudo) throw new Error(tr('읽기 명령만 되풀이해서 실행할 수 있어요')) // 로드 때 거른 것을 한 번 더 확인
    if (!/^[\w-]{1,64}$/.test(String(pollId))) throw new Error(tr('올바르지 않은 요청이에요'))
    const c = client(connId)
    startPoll(e.sender, { run: (cmd) => run(c, cmd), onClose: (cb) => (c.once('close', cb), () => void c.off('close', cb)) }, String(pollId), pack.id, buildPoll(a), d, a.timeout ?? LIMITS.chartTimeoutDefault)
  })
  ipcMain.handle('pack:poll-stop', (_e, pollId: string): void => stopPoll(String(pollId)))
  // 탐색기 배지(5.3.0): 폴더를 열 때 켜진 팩의 배지를 실행. 팩을 켜 둔 채 끈 배지(badgesOff)는 건너뜀. null = 새 요청에 밀렸거나 화면이 사라짐
  const watched = new Set<string>()
  ipcMain.handle('pack:badges', (e, connId: string, dir: string): Promise<BadgeResult[] | null> => {
    const c = client(connId)
    if (!watched.has(connId)) {
      watched.add(connId)
      c.once('close', () => (watched.delete(connId), dropConn(connId)))
    }
    const targets = enabledPacks(entries).flatMap((p) => (p.badges ?? []).filter((b) => !state.packs[p.id]?.badgesOff?.includes(b.id)).map((badge) => ({ packId: p.id, badge })))
    return runBadges(e.sender, connId, { run: (cmd) => run(c, cmd) }, String(dir), targets)
  })
  ipcMain.handle('pack:badges-off', (_e, packId: string, ids: string[]): Catalog => {
    save(setBadgesOff(state, entryOf(packId), Array.isArray(ids) ? ids : []))
    return rescan()
  })
  app.on('before-quit', stopAll)
  app.on('before-quit', stopAllPolls)
}
