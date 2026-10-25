import { ipcMain, type WebContents } from 'electron'
import { tr } from './i18n.mts'
import type { ClientChannel } from 'ssh2'
import { LiveSet } from './liveset.mts'
import { run } from './monitor'
import { shq as q } from './shq.mts'
import { isParamName, isRosName, isSrvType, parseBags, parseLaunches, parseParamDump, parseRosList, parseServices, requestTemplate, type Bag, type Launch, type Param, type RosList, type Service } from './rosparse.mts'
import { ptyStream } from './ptystream'
import { requireClient as client } from './session'

// ROS2 도구: 젯슨에 아무것도 설치하지 않고 SSH로 ros2 CLI만 실행
// ROS 환경은 사용자의 ~/.bashrc(source /opt/ros/<배포판>/setup.bash)에서 오므로 interactive bash(-i)로 실행
const bash = (cmd: string) => `bash -ic ${q(cmd)} 2>/dev/null`
const NO_ROS = 'command -v ros2 >/dev/null || { echo __NOROS__; exit 0; }; '

const noRos = () => new Error(tr('이 기기에서 ros2 명령을 찾지 못했어요. ROS2를 설치하고 ~/.bashrc에 source /opt/ros/<배포판>/setup.bash를 넣어 주세요'))
// ROS 명령 하나 실행: ros2가 없으면 출력(__NOROS__) 대신 알기 쉬운 오류
const ros = async (connId: string, cmd: string) => {
  const out = (await run(client(connId), bash(`${NO_ROS}${cmd}`))).trim()
  if (out.includes('__NOROS__')) throw noRos()
  return out
}

async function list(connId: string): Promise<RosList> {
  // ros2 데몬이 처음 뜰 때 몇 초 걸림. 멈춘 경우를 대비해 명령마다 timeout
  const out = await run(client(connId), bash(`${NO_ROS}echo "__DISTRO__=$ROS_DISTRO"; echo __TOPICS__; timeout 20 ros2 topic list -t; echo __NODES__; timeout 20 ros2 node list`))
  const r = parseRosList(out)
  if (!r) throw noRos()
  return r
}

async function info(connId: string, kind: 'topic' | 'node', name: string): Promise<string> {
  if (!isRosName(name)) throw new Error(tr('ROS 이름 형식이 아니에요'))
  const cmd = kind === 'topic' ? `ros2 topic info -v ${q(name)}` : `ros2 node info ${q(name)}`
  return ros(connId, `timeout 20 ${cmd} 2>&1`)
}

// launch 파일 찾기: 홈 아래 워크스페이스 소스 + 설치된 패키지(AMENT_PREFIX_PATH의 share/*/launch)
// build·install·log·숨김 폴더는 건너뜀. 너무 많으면 앞에서 자름
async function launches(connId: string): Promise<Launch[]> {
  const ws = `find ~ -maxdepth 7 \\( -name build -o -name install -o -name log -o -name '.*' \\) -prune -o -type f \\( -name '*launch.py' -o -name '*launch.xml' -o -name '*launch.yaml' -o -name '*launch.yml' \\) -print 2>/dev/null | head -300`
  const installed = `for p in $(echo "$AMENT_PREFIX_PATH" | tr ':' ' '); do find "$p/share" -mindepth 3 -maxdepth 4 -path '*/launch/*' \\( -name '*launch.py' -o -name '*launch.xml' -o -name '*launch.yaml' -o -name '*launch.yml' \\) 2>/dev/null; done | head -1000`
  return parseLaunches(await run(client(connId), bash(`${ws}; ${installed}`)))
}

// echo·hz 실시간 보기 (pty 실행·시작 직후 정지 처리는 ptyStream)
const streams = new LiveSet<ClientChannel>()
function startStream(wc: WebContents, connId: string, id: string, kind: 'echo' | 'hz', topic: string): Promise<void> {
  if (!isRosName(topic)) throw new Error(tr('ROS 이름 형식이 아니에요'))
  const cmd = kind === 'hz' ? `exec ros2 topic hz ${q(topic)}` : `exec ros2 topic echo --truncate-length 200 --no-arr ${q(topic)}`
  return ptyStream(wc, connId, id, cmd, streams, 'ros:data', 'ros:end')
}

// ---- 2.4.0: 서비스·파라미터·bag ----

async function services(connId: string): Promise<Service[]> {
  const r = parseServices(await run(client(connId), bash(`${NO_ROS}timeout 20 ros2 service list -t`)))
  if (!r) throw noRos()
  return r
}
// 서비스 타입의 요청·응답 정의 + 요청 YAML 뼈대
async function iface(connId: string, type: string): Promise<{ text: string; template: string }> {
  if (!isSrvType(type)) throw new Error(tr('서비스 타입 형식이 아니에요'))
  const text = await ros(connId, `timeout 20 ros2 interface show ${q(type)} 2>&1`)
  return { text, template: requestTemplate(text) }
}
// 서비스 호출: 서버가 없으면 영원히 기다리므로 15초 제한. 요청 YAML은 ros2가 해석 (셸에는 따옴표로만 전달)
async function serviceCall(connId: string, name: string, type: string, yaml: string): Promise<string> {
  if (!isRosName(name) || !isSrvType(type)) throw new Error(tr('ROS 이름 형식이 아니에요'))
  return ros(connId, `timeout 15 ros2 service call ${q(name)} ${q(type)} ${q(String(yaml).trim() || '{}')} 2>&1`)
}
async function params(connId: string, node: string): Promise<Param[]> {
  if (!isRosName(node)) throw new Error(tr('ROS 이름 형식이 아니에요'))
  const out = await ros(connId, `timeout 20 ros2 param dump ${q(node)} 2>&1`)
  const list = parseParamDump(out)
  if (!list.length && out) throw new Error(out) // 노드가 없어졌거나 파라미터를 못 읽음
  return list
}
async function paramSet(connId: string, node: string, name: string, value: string): Promise<string> {
  if (!isRosName(node) || !isParamName(name)) throw new Error(tr('ROS 이름 형식이 아니에요'))
  return ros(connId, `timeout 20 ros2 param set ${q(node)} ${q(name)} ${q(String(value))} 2>&1`)
}
// bag 찾기: 홈 아래 metadata.yaml 중 rosbag2 것만 (build·install·log·숨김 폴더 제외)
async function bags(connId: string): Promise<Bag[]> {
  return parseBags(await ros(connId, `find ~ -maxdepth 7 \\( -name build -o -name install -o -name log -o -name '.*' \\) -prune -o -type f -name metadata.yaml -print0 2>/dev/null | xargs -0 -r grep -l rosbag2_bagfile_information 2>/dev/null | head -200`))
}
async function bagInfo(connId: string, path: string): Promise<string> {
  if (!path.startsWith('/') || /[\0\n]/.test(path)) throw new Error(tr('bag 경로가 올바르지 않아요'))
  return ros(connId, `timeout 20 ros2 bag info ${q(path)} 2>&1`)
}

export function registerRosIpc(): void {
  ipcMain.handle('ros:list', (_e, connId: string) => list(connId))
  ipcMain.handle('ros:info', (_e, connId: string, kind: 'topic' | 'node', name: string) => info(connId, kind === 'node' ? 'node' : 'topic', String(name)))
  ipcMain.handle('ros:launches', (_e, connId: string) => launches(connId))
  ipcMain.handle('ros:stream', (e, connId: string, id: string, kind: 'echo' | 'hz', topic: string) => startStream(e.sender, connId, String(id), kind === 'hz' ? 'hz' : 'echo', String(topic)))
  ipcMain.handle('ros:services', (_e, connId: string) => services(connId))
  ipcMain.handle('ros:iface', (_e, connId: string, type: string) => iface(connId, String(type)))
  ipcMain.handle('ros:call', (_e, connId: string, name: string, type: string, yaml: string) => serviceCall(connId, String(name), String(type), yaml))
  ipcMain.handle('ros:params', (_e, connId: string, node: string) => params(connId, String(node)))
  ipcMain.handle('ros:paramSet', (_e, connId: string, node: string, name: string, value: string) => paramSet(connId, String(node), String(name), value))
  ipcMain.handle('ros:bags', (_e, connId: string) => bags(connId))
  ipcMain.handle('ros:bagInfo', (_e, connId: string, path: string) => bagInfo(connId, String(path)))
  ipcMain.handle('ros:stop', (_e, id: string) => streams.stop(String(id)))
}
