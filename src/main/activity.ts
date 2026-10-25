import { ipcMain, type WebContents } from 'electron'
import { detailOf, finishAct, startAct, summarize, type Act, type ToolResult } from './activitylog.mts'

// AI 활동 기록: MCP로 들어온 요청을 최근 500건까지 앱 메모리에만 보관 (파일에는 쓰지 않음, 앱을 닫으면 사라짐)
const list: Act[] = []
export type ActLite = Omit<Act, 'detail'>
const lite = ({ detail: _d, ...rest }: Act): ActLite => rest

const push = (wc: WebContents | null, a: Act) => {
  if (wc && !wc.isDestroyed()) wc.send('activity:event', lite(a))
}

// 직접 시작·끝을 알리는 기록 (다른 SSH 접속 관찰이 씀)
export function begin(wc: WebContents | null, a: Omit<Act, 'id' | 'status' | 'ms' | 'detail'>): Act {
  const act = startAct(list, a)
  push(wc, act)
  return act
}
export function end(wc: WebContents | null, act: Act, detail: string, now = Date.now()): void {
  finishAct(act, 'ok', detail, now)
  push(wc, act)
}

// 요청 하나를 기록하면서 실행. 시작할 때 '실행 중', 끝나면 결과·걸린 시간. 오류는 기록 후 다시 던짐
export async function track(wc: WebContents | null, meta: { tool: string; args: Record<string, unknown>; client: string; connId: string; host: string }, fn: () => Promise<ToolResult>): Promise<string> {
  const act = startAct(list, { t: Date.now(), client: meta.client, connId: meta.connId, host: meta.host, tool: meta.tool, summary: summarize(meta.tool, meta.args) })
  push(wc, act)
  try {
    const { text, status = 'ok' } = await fn()
    finishAct(act, status, detailOf(meta.tool, text), Date.now())
    return text
  } catch (e) {
    finishAct(act, 'error', detailOf(meta.tool, (e as Error).message), Date.now())
    throw e
  } finally {
    push(wc, act)
  }
}

export const recentActs = (): ActLite[] => list.slice(-50).map(lite)

export function registerActivityIpc(): void {
  ipcMain.handle('activity:list', (): ActLite[] => list.map(lite))
  ipcMain.handle('activity:detail', (_e, id: number) => list.find((a) => a.id === Number(id))?.detail ?? '')
  ipcMain.handle('activity:clear', () => void list.splice(0, list.length))
}
