import { ipcMain, type WebContents } from 'electron'
import { tr } from './i18n.mts'
import type { ClientChannel } from 'ssh2'
import { run } from './monitor'
import { requireClient } from './session'
import { LiveSet } from './liveset.mts'
import { buildPipeline, FrameSplitter, LIST_CMD, parseCameras, type CamList } from './camparse.mts'

// 카메라 미리보기: Device에는 설치 없이 gst-launch(v4l2src)를 SSH로 실행해 JPEG 프레임을 받음
const live = new LiveSet<ClientChannel>() // 화면이 정한 id → 실행 중인 채널

export function registerCamIpc(): void {
  ipcMain.handle('cam:list', async (_e, connId: string): Promise<CamList> => parseCameras(await run(requireClient(connId), `timeout 20 ${LIST_CMD}`)))
  ipcMain.handle('cam:start', (e, connId: string, rawId: string, path: string, fourcc: string, w: number, h: number, fps: number) => {
    const id = String(rawId)
    const cmd = buildPipeline(String(path), String(fourcc), Number(w), Number(h), Number(fps))
    const wc: WebContents = e.sender
    return new Promise<void>((resolve, reject) => {
      live.begin(id)
      try {
        requireClient(connId).exec(cmd, (err, ch) => {
          if (err) return live.fail(id), reject(err)
          ch.on('error', () => {})
          if (!live.attach(id, ch)) return resolve() // 여는 중에 정지됨 → 채널을 닫아 gst도 끝남
          const split = new FrameSplitter()
          let errText = ''
          let got = false
          ch.on('data', (d: Buffer) => {
            for (const f of split.push(d)) {
              got = true
              if (!wc.isDestroyed()) wc.send('cam:frame', id, f)
            }
          })
          ch.stderr.on('data', (d: Buffer) => (errText = (errText + d.toString('utf8')).slice(-300)))
          ch.on('close', () => {
            live.remove(id, ch)
            if (!wc.isDestroyed()) wc.send('cam:end', id, got ? '' : errText.trim() || tr('카메라에서 영상을 받지 못했어요 (다른 프로그램이 쓰는 중일 수 있어요)'))
          })
          resolve()
        })
      } catch (err) {
        live.fail(id)
        reject(err) // 연결이 막 끊긴 경우 ssh2가 예외를 던짐
      }
    })
  })
  // 채널을 닫으면 gst는 다음 프레임을 쓰다 SIGPIPE로 끝남
  ipcMain.on('cam:stop', (_e, id: string) => live.stop(String(id)))
}
