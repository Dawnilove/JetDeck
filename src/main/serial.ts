import { ipcMain } from 'electron'
import { SerialPort } from 'serialport'
import type { SerialChoice } from './packserial.mts'
import { openRead, type PortLike, type SerialSource } from './serialread.mts'
import { serialError } from './serialmsg.mts'

export type PortInfo = { path: string; label: string }

// 연결된 시리얼 포트 목록. 이름은 OS가 알려 준 장치 이름 (예: "USB Serial Device (COM5)")
export async function listPorts(): Promise<PortInfo[]> {
  const list = await SerialPort.list()
  return list.map((p) => ({ path: p.path, label: (p as { friendlyName?: string }).friendlyName || p.manufacturer || p.path }))
}

// 팩 시리얼 읽기용 목록: 같은 장치인지 확인할 USB 정보(VID·PID·시리얼 번호)도 같이
export async function listChoices(): Promise<SerialChoice[]> {
  return (await SerialPort.list()).map((p) => ({
    path: p.path,
    label: (p as { friendlyName?: string }).friendlyName || p.manufacturer || p.path,
    vendorId: p.vendorId,
    productId: p.productId,
    serialNumber: p.serialNumber,
    pnpId: p.pnpId,
    locationId: p.locationId
  }))
}

// 팩 시리얼 읽기: 읽기 전용으로 엶 (쓰기 함수 없음, 제어선 낮춤). 규칙은 serialread.mts
export const openSerialRead = (path: string, baud: number): Promise<SerialSource> => openRead((o) => new SerialPort(o as ConstructorParameters<typeof SerialPort>[0]) as unknown as PortLike, path, baud)

export function openSerial(path: string, baud: number): Promise<SerialPort> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path, baudRate: baud, autoOpen: false }) // 기본 8N1
    port.open((err) => (err ? reject(new Error(serialError(err.message, path))) : resolve(port)))
  })
}

export function registerSerialIpc(): void {
  ipcMain.handle('serial:list', () => listPorts())
}
