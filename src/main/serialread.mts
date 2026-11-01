// 팩 시리얼 읽기의 포트 열기 (6.1.0, 설계안 §2-4): 읽기 전용. 쓰기 함수는 돌려주지 않고, 제어선(DTR·RTS)을 낮춘 채로 연다.
// OS는 읽기 전용 열기를 지원하지 않는다 (항상 읽기+쓰기로 엶) → 쓰기 함수가 구조에 없는 것으로 지킨다. Electron·실제 포트 없이 시험 (serialread.test.mts)
import { tr } from './i18n.mts'
import { LIMITS } from './packschema.mts'
import { serialError } from './serialmsg.mts'

// 포트 데이터를 받는 쪽이 볼 수 있는 전부: 데이터·끝남·닫기. write·set은 없다
export type SerialSource = {
  onData(cb: (b: Buffer) => void): void
  onEnd(cb: (why: 'closed' | 'error') => void): void
  close(): void
}

// serialport의 SerialPort에서 쓰는 부분만 (시험은 가짜 바인딩을 쓴 SerialPortStream)
export interface PortLike {
  open(cb: (err?: Error | null) => void): void
  on(ev: 'data', cb: (b: Buffer) => void): unknown
  on(ev: 'error' | 'close', cb: (e?: Error) => void): unknown
  set(o: { dtr?: boolean; rts?: boolean }, cb?: (err?: Error | null) => void): unknown
  close(cb?: (err?: Error | null) => void): unknown
  readonly isOpen: boolean
}

// 열기 옵션 고정: 팩이 바꾸지 못한다. hupcl:false → Windows는 DTR을 켜지 않고, rtscts:false → RTS를 켜지 않음. lock:true → 다른 프로그램이 쓰는 포트는 못 엶
export const READ_OPEN = { dataBits: 8, stopBits: 1, parity: 'none', lock: true, hupcl: false, rtscts: false, xon: false, xoff: false, xany: false } as const

export function openRead(make: (o: Record<string, unknown>) => PortLike, path: string, baud: number, platform: string = process.platform, openMs = LIMITS.serialOpenSeconds * 1000): Promise<SerialSource> {
  return new Promise((resolve, reject) => {
    const port = make({ path, baudRate: baud, autoOpen: false, ...READ_OPEN })
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(tr('{0}을(를) 여는 데 너무 오래 걸려요. 장치를 확인하세요', path)))
    }, openMs)
    timer.unref?.()
    port.open((err) => {
      clearTimeout(timer)
      if (err) {
        if (!settled) (settled = true), reject(new Error(serialError(err.message, path)))
        return
      }
      if (settled) return void port.close() // 시간이 지난 뒤 열렸다: 쓰지 않고 바로 닫음
      settled = true
      // Linux는 열고 나서야 제어선을 낮출 수 있다 (여는 순간의 변화는 막지 못함 → 확인 창이 경고). 실패해도 읽기는 계속
      if (platform === 'linux') port.set({ dtr: false, rts: false }, () => {})
      resolve({
        onData: (cb) => void port.on('data', cb),
        onEnd: (cb) => {
          port.on('error', () => cb('error'))
          port.on('close', () => cb('closed'))
        },
        close: () => void (port.isOpen && port.close())
      })
    })
  })
}
