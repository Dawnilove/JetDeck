// 카메라 미리보기: v4l2 장치 목록 파서, gst 명령 만들기, multipart(JPEG) 프레임 분리기
import { tr } from './i18n.mts'
// 따옴표 안에서 $가 그대로 기기 셸로 가도록 작은따옴표 없이 작성
export const LIST_CMD = 'sh -c \'for d in /dev/video*; do [ -e "$d" ] || continue; echo "@@DEV $d $(cat /sys/class/video4linux/$(basename $d)/name 2>/dev/null)"; v4l2-ctl -d $d --list-formats-ext 2>/dev/null; done; command -v gst-launch-1.0 >/dev/null 2>&1 || echo "@@NOGST"; command -v v4l2-ctl >/dev/null 2>&1 || echo "@@NOV4L2"\''

export type Mode = { w: number; h: number; fps: number[] }
export type Camera = { path: string; name: string; fourcc: 'MJPG' | 'YUYV'; modes: Mode[] }
export type CamList = { cameras: Camera[]; nogst: boolean; nov4l2: boolean }

export function parseCameras(text: string): CamList {
  const out: CamList = { cameras: [], nogst: text.includes('@@NOGST'), nov4l2: text.includes('@@NOV4L2') }
  for (const sec of text.split('@@DEV ').slice(1)) {
    const lines = sec.split('\n')
    const head = lines[0].trim().match(/^(\/dev\/video\d+)\s*(.*)$/)
    if (!head) continue
    const fmts = new Map<string, Mode[]>()
    let cur: Mode[] | null = null
    for (const l of lines.slice(1)) {
      const f = l.match(/^\s*\[\d+\]:\s*'(\w{4})'/)
      if (f) {
        cur = fmts.get(f[1]) ?? []
        fmts.set(f[1], cur)
        continue
      }
      const s = l.match(/Size: Discrete (\d+)x(\d+)/)
      if (s && cur) cur.push({ w: Number(s[1]), h: Number(s[2]), fps: [] })
      const i = l.match(/Interval: Discrete [\d.]+s \(([\d.]+) fps\)/)
      if (i && cur?.length) cur[cur.length - 1].fps.push(Math.round(Number(i[1])))
    }
    // MJPG가 있으면 그것을(젯슨에서 변환 없이 전송), 없으면 YUYV (젯슨에서 JPEG로 변환)
    const fourcc = fmts.has('MJPG') ? 'MJPG' : fmts.has('YUYV') ? 'YUYV' : null
    const modes = fourcc ? fmts.get(fourcc)!.filter((m) => m.fps.length) : []
    if (fourcc && modes.length) out.cameras.push({ path: head[1], name: head[2].trim() || head[1], fourcc, modes })
  }
  return out
}

export const BOUNDARY = 'jdframe'
const isInt = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0 && (n as number) <= 10000

// 입력은 화면에서 오므로 장치 경로·숫자를 확인한 뒤에만 명령에 넣음
export function buildPipeline(path: string, fourcc: string, w: number, h: number, fps: number): string {
  if (!/^\/dev\/video\d+$/.test(path) || !isInt(w) || !isInt(h) || !isInt(fps)) throw new Error(tr('카메라 설정이 올바르지 않아요'))
  const src = `gst-launch-1.0 -q v4l2src device=${path} !`
  const caps = fourcc === 'MJPG' ? `image/jpeg,width=${w},height=${h},framerate=${fps}/1 !` : `video/x-raw,format=YUY2,width=${w},height=${h},framerate=${fps}/1 ! videoconvert ! jpegenc quality=75 !`
  return `${src} ${caps} multipartmux boundary=${BOUNDARY} ! fdsink fd=1`
}

// gst multipartmux 출력("--경계\r\nContent-Type…\r\nContent-Length: N\r\n\r\n" + JPEG N바이트)에서 JPEG 한 장씩 꺼냄
export class FrameSplitter {
  private buf = Buffer.alloc(0)
  push(chunk: Buffer): Buffer[] {
    this.buf = Buffer.concat([this.buf, chunk])
    const frames: Buffer[] = []
    for (;;) {
      const at = this.buf.indexOf('Content-Length: ')
      if (at < 0) {
        this.buf = this.buf.subarray(Math.max(0, this.buf.length - 32)) // 헤더가 조각나 올 수 있어 끝부분만 남김
        break
      }
      const end = this.buf.indexOf('\r\n\r\n', at)
      if (end < 0) break
      const n = Number(this.buf.subarray(at + 16, this.buf.indexOf('\r\n', at)).toString())
      const start = end + 4
      if (!Number.isInteger(n) || n < 0 || n > 64 * 1024 * 1024) {
        this.buf = this.buf.subarray(start) // 깨진 헤더는 건너뜀
        continue
      }
      if (this.buf.length < start + n) break
      frames.push(this.buf.subarray(start, start + n))
      this.buf = this.buf.subarray(start + n)
    }
    return frames
  }
}
