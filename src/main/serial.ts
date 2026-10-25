import { ipcMain } from 'electron'
import { SerialPort } from 'serialport'
import { serialError } from './serialmsg.mts'

export type PortInfo = { path: string; label: string }

// 연결된 시리얼 포트 목록. 이름은 OS가 알려 준 장치 이름 (예: "USB Serial Device (COM5)")
export async function listPorts(): Promise<PortInfo[]> {
  const list = await SerialPort.list()
  return list.map((p) => ({ path: p.path, label: (p as { friendlyName?: string }).friendlyName || p.manufacturer || p.path }))
}

export function openSerial(path: string, baud: number): Promise<SerialPort> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path, baudRate: baud, autoOpen: false }) // 기본 8N1
    port.open((err) => (err ? reject(new Error(serialError(err.message, path))) : resolve(port)))
  })
}

export function registerSerialIpc(): void {
  ipcMain.handle('serial:list', () => listPorts())
}
