import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { tr } from './i18n.mts'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { bucket, localTime, push, toCsv, toSample, type Bucket, type Sample } from './historyfmt.mts'
import type { Stats } from './tegrastats.mts'

// 모니터 기록: 연결별로 최근 1시간만 앱 메모리에 보관 (파일에는 쓰지 않음). 연결이 끊겼다 다시 붙어도 이어서 쌓고, 연결을 직접 닫을 때 지움
const history = new Map<string, Sample[]>()

export function record(connId: string, stats: Stats): void {
  let buf = history.get(connId)
  if (!buf) history.set(connId, (buf = []))
  push(buf, toSample(Date.now(), stats))
}
export const clearHistory = (connId: string) => void history.delete(connId)

export function registerHistoryIpc(): void {
  // 화면은 구간(분)과 칸 수만 정하고 줄인 값을 받음 (1시간 전체를 0.5초 단위로 보내지 않게)
  ipcMain.handle('history:get', (_e, connId: string, minutes: number, n: number): { from: number; to: number; points: (Bucket | null)[] } => {
    const to = Date.now()
    const from = to - Math.max(1, Math.min(60, Math.floor(Number(minutes)) || 15)) * 60_000
    return { from, to, points: bucket(history.get(String(connId)) ?? [], from, to, Math.max(10, Math.min(600, Math.floor(Number(n)) || 300))) }
  })

  // CSV 내보내기: 저장 위치는 사용자가 고름. 파일 이름에는 기기 이름을 넣지 않음
  ipcMain.handle('history:export', async (e, connId: string): Promise<string | null> => {
    const buf = history.get(String(connId)) ?? []
    if (!buf.length) throw new Error(tr('아직 기록된 값이 없어요'))
    const win = BrowserWindow.fromWebContents(e.sender)!
    const name = `jetdeck-monitor-${localTime(buf[0].t).slice(0, 19).replace(/[- :]/g, '').replace(/^(\d{8})(\d{6})$/, '$1_$2')}.csv`
    const r = await dialog.showSaveDialog(win, { title: tr('모니터 기록 내보내기'), defaultPath: join(app.getPath('downloads'), name), filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, '﻿' + toCsv(buf), 'utf8') // BOM: Excel이 한글 경로·UTF-8을 올바르게 열게
    return r.filePath
  })
}
