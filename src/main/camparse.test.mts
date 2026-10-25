import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPipeline, FrameSplitter, parseCameras } from './camparse.mts'

const SAMPLE = `@@DEV /dev/video0 HD 4MP WEBCAM
ioctl: VIDIOC_ENUM_FMT
	Type: Video Capture

	[0]: 'MJPG' (Motion-JPEG, compressed)
		Size: Discrete 640x480
			Interval: Discrete 0.033s (30.000 fps)
			Interval: Discrete 0.067s (15.000 fps)
		Size: Discrete 1280x720
			Interval: Discrete 0.033s (30.000 fps)
	[1]: 'YUYV' (YUYV 4:2:2)
		Size: Discrete 320x240
			Interval: Discrete 0.033s (30.000 fps)
@@DEV /dev/video1 HD 4MP WEBCAM
ioctl: VIDIOC_ENUM_FMT
	Type: Video Capture

@@DEV /dev/video2 Old Cam
	[0]: 'YUYV' (YUYV 4:2:2)
		Size: Discrete 320x240
			Interval: Discrete 0.100s (10.000 fps)
`

test('장치 목록: MJPG 우선, 형식 없는 노드 제외, YUYV 대체', () => {
  const r = parseCameras(SAMPLE)
  assert.equal(r.cameras.length, 2)
  assert.deepEqual(r.cameras[0], { path: '/dev/video0', name: 'HD 4MP WEBCAM', fourcc: 'MJPG', modes: [{ w: 640, h: 480, fps: [30, 15] }, { w: 1280, h: 720, fps: [30] }] })
  assert.equal(r.cameras[1].fourcc, 'YUYV')
  assert.equal(r.nogst, false)
  assert.equal(parseCameras('@@NOGST\n@@NOV4L2').nogst, true)
})

test('명령: 장치 경로·숫자 확인', () => {
  assert.match(buildPipeline('/dev/video0', 'MJPG', 640, 480, 15), /image\/jpeg,width=640,height=480,framerate=15\/1/)
  assert.match(buildPipeline('/dev/video2', 'YUYV', 320, 240, 10), /videoconvert ! jpegenc/)
  assert.throws(() => buildPipeline('/dev/video0; rm -rf ~', 'MJPG', 640, 480, 15))
  assert.throws(() => buildPipeline('/dev/video0', 'MJPG', 640, 480, 0))
})

test('프레임 분리: 조각나서 와도 JPEG 한 장씩', () => {
  const mk = (b: string) => Buffer.concat([Buffer.from(`--jdframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${b.length}\r\n\r\n`), Buffer.from(b), Buffer.from('\r\n')])
  const all = Buffer.concat([mk('AAAA'), mk('BBBBBB')])
  const sp = new FrameSplitter()
  const got: string[] = []
  for (let i = 0; i < all.length; i += 7) sp.push(all.subarray(i, i + 7)).forEach((f) => got.push(f.toString())) // 7바이트씩
  assert.deepEqual(got, ['AAAA', 'BBBBBB'])
})
