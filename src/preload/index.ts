import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { JobIn, LocalEntry, XferEvent } from '../main/transfer'
import type { Found } from '../main/discover'
import type { FwdStatus, Rule } from '../main/forward'
import type { Bucket } from '../main/historyfmt.mts'
import type { ActLite as Act } from '../main/activity'
import type { Proc } from '../main/procparse.mts'
import type { DockerAction, DockerData } from '../main/dockerparse.mts'
import type { RemoteResult } from '../main/remote'
import type { Guide } from '../main/vncparse.mts'
import type { BuildKind } from '../main/buildparse.mts'
import type { ActionResult, SvcAction, SvcData } from '../main/svcparse.mts'
import type { Health } from '../main/healthparse.mts'
import type { Snip } from '../main/settingsio.mts'
import type { ImportResult } from '../main/settingsfile'
import type { GitInfo } from '../main/gitparse.mts'
import type { ReplaceResult } from '../main/search'
import type { Hit, SearchOpts } from '../main/searchparse.mts'
import type { CamList } from '../main/camparse.mts'
import type { UpdateState } from '../main/update'
import type { MonitorEvent } from '../main/monitor'
import type { SessionInfo } from '../main/session'
import type { Bag, Launch, Param, RosList, Service } from '../main/rosparse.mts'
import type { PortInfo } from '../main/serial'
import type { Entry } from '../main/sftp'
import type { HostKeyInfo } from '../main/ssh'
import type { Host, HostInfo } from '../main/store'

// 화면에서 쓸 수 있는 API 통로. 화면은 이 함수들로만 Node(main) 기능을 씀
const api = {
  listHosts: (): Promise<HostInfo[]> => ipcRenderer.invoke('hosts:list'),
  saveHost: (host: Host, password?: string): Promise<HostInfo> => ipcRenderer.invoke('hosts:save', host, password),
  deleteHost: (id: string): Promise<void> => ipcRenderer.invoke('hosts:delete', id),
  probe: (host: string, port: number): Promise<number | null> => ipcRenderer.invoke('hosts:probe', host, port),
  wakeHost: (id: string): Promise<void> => ipcRenderer.invoke('host:wake', id),
  scanJetsons: (): Promise<Found[]> => ipcRenderer.invoke('discover:scan'),
  listSerial: (): Promise<PortInfo[]> => ipcRenderer.invoke('serial:list'),
  pickKey: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickKey'),
  listThemes: (): Promise<unknown[]> => ipcRenderer.invoke('themes:list'),
  testSsh: (host: Host, password?: string): Promise<string> => ipcRenderer.invoke('ssh:test', host, password),
  installKey: (host: Host, password?: string): Promise<string> => ipcRenderer.invoke('ssh:installKey', host, password),
  onHostKey: (cb: (info: HostKeyInfo) => void) => on('hostkey:ask', cb),
  answerHostKey: (id: string, answer: 'cancel' | 'once' | 'trust' | 'replace') => ipcRenderer.send('hostkey:answer', id, answer),

  // 터미널 세션
  openSession: (id: string, hostId: string, cols: number, rows: number): Promise<SessionInfo> =>
    ipcRenderer.invoke('session:open', id, hostId, cols, rows),
  writeSession: (id: string, data: string) => ipcRenderer.send('session:write', id, data),
  resizeSession: (id: string, cols: number, rows: number) => ipcRenderer.send('session:resize', id, cols, rows),
  closeSession: (id: string): Promise<void> => ipcRenderer.invoke('session:close', id),
  openTerm: (connId: string, termId: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('term:open', connId, termId, cols, rows),
  closeTerm: (termId: string): Promise<void> => ipcRenderer.invoke('term:close', termId),

  // 원격 파일 (SFTP)
  fsHome: (connId: string): Promise<string> => ipcRenderer.invoke('fs:home', connId),
  fsList: (connId: string, dir: string): Promise<Entry[]> => ipcRenderer.invoke('fs:list', connId, dir),
  fsRead: (connId: string, path: string): Promise<{ text: string; mtime: number }> => ipcRenderer.invoke('fs:read', connId, path),
  fsWrite: (connId: string, path: string, text: string, mtime: number | null, force = false): Promise<{ conflict: true } | { mtime: number }> =>
    ipcRenderer.invoke('fs:write', connId, path, text, mtime, force),
  fsNewFile: (connId: string, dir: string, name: string): Promise<string> => ipcRenderer.invoke('fs:newFile', connId, dir, name),
  fsNewFolder: (connId: string, dir: string, name: string): Promise<string> => ipcRenderer.invoke('fs:newFolder', connId, dir, name),
  fsRename: (connId: string, path: string, name: string): Promise<string> => ipcRenderer.invoke('fs:rename', connId, path, name),
  fsDelete: (connId: string, path: string, dir: boolean): Promise<void> => ipcRenderer.invoke('fs:delete', connId, path, dir),
  fsFind: (connId: string, dir: string): Promise<string[]> => ipcRenderer.invoke('fs:find', connId, dir),
  gitStatus: (connId: string, dir: string): Promise<GitInfo | null> => ipcRenderer.invoke('git:status', connId, dir),
  searchGrep: (connId: string, dir: string, query: string, o: SearchOpts): Promise<{ hits: Hit[]; truncated: boolean }> => ipcRenderer.invoke('search:grep', connId, dir, query, o),
  searchReplace: (connId: string, paths: string[], query: string, repl: string, o: SearchOpts): Promise<ReplaceResult> => ipcRenderer.invoke('search:replace', connId, paths, query, repl, o),

  // 파일 전송
  listLocal: (dir?: string): Promise<{ dir: string; parent: string | null; entries: LocalEntry[] }> => ipcRenderer.invoke('local:list', dir),
  xferConflicts: (connId: string, jobs: JobIn[]): Promise<string[]> => ipcRenderer.invoke('xfer:conflicts', connId, jobs),
  xferAdd: (connId: string, jobs: JobIn[]): Promise<string[]> => ipcRenderer.invoke('xfer:add', connId, jobs),
  xferCancel: (id: string): Promise<void> => ipcRenderer.invoke('xfer:cancel', id),
  pickUpload: (folder?: boolean): Promise<{ path: string; name: string; size: number }[]> => ipcRenderer.invoke('dialog:pickUpload', folder),
  pickDownloadDir: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickDownloadDir'),
  onXfer: (cb: (e: XferEvent) => void) => on('xfer', cb),

  // 포트 포워딩
  fwdList: (connId: string, hostId: string): Promise<(Rule & { active: boolean })[]> => ipcRenderer.invoke('fwd:list', connId, hostId),
  fwdAdd: (connId: string, hostId: string, rule: Partial<Rule>): Promise<Rule> => ipcRenderer.invoke('fwd:add', connId, hostId, rule),
  fwdToggle: (connId: string, hostId: string, ruleId: string, on: boolean): Promise<void> => ipcRenderer.invoke('fwd:toggle', connId, hostId, ruleId, on),
  fwdDelete: (connId: string, hostId: string, ruleId: string): Promise<void> => ipcRenderer.invoke('fwd:delete', connId, hostId, ruleId),
  onFwdStatus: (cb: (s: FwdStatus) => void) => on('fwd:status', cb),

  // 원격 화면(RDP·VNC): SSH 터널을 열고 mstsc·VNC 뷰어 실행
  remoteOpen: (connId: string, hostId: string): Promise<RemoteResult> => ipcRenderer.invoke('remote:open', connId, hostId),

  // 모니터 기록 (최근 1시간, 앱 메모리에만): 구간·칸 수를 정해 줄인 값 / CSV 내보내기(저장 위치는 대화상자)
  historyGet: (connId: string, minutes: number, n: number): Promise<{ from: number; to: number; points: (Bucket | null)[] }> => ipcRenderer.invoke('history:get', connId, minutes, n),
  historyExport: (connId: string): Promise<string | null> => ipcRenderer.invoke('history:export', connId),

  // AI 활동 기록 (MCP로 들어온 요청, 앱 메모리에만): 목록·자세히·비우기·실시간 알림
  activityList: (): Promise<Act[]> => ipcRenderer.invoke('activity:list'),
  activityDetail: (id: number): Promise<string> => ipcRenderer.invoke('activity:detail', id),
  activityClear: (): Promise<void> => ipcRenderer.invoke('activity:clear'),
  onActivity: (cb: (a: Act) => void) => on('activity:event', cb),

  // 다른 SSH 접속 관찰 켜고 끄기 (기본 켬, 이 PC에 기억)
  observeGet: (): Promise<boolean> => ipcRenderer.invoke('observe:get'),
  observeSet: (on: boolean): Promise<void> => ipcRenderer.invoke('observe:set', on),

  // 프로세스 목록·종료 (ps·kill을 SSH로 실행. 종료는 화면에서 확인 창을 거친 뒤에만 부름)
  procList: (connId: string): Promise<{ me: string; procs: Proc[] }> => ipcRenderer.invoke('proc:list', connId),
  procKill: (connId: string, pid: number, args: string, force: boolean): Promise<void> => ipcRenderer.invoke('proc:kill', connId, pid, args, force),

  // 서비스 (systemctl·journalctl): 실시간 로그는 svc:data로 흘러오고 끝나면 svc:end
  svcList: (connId: string): Promise<SvcData> => ipcRenderer.invoke('svc:list', connId),
  svcAction: (connId: string, unit: string, action: SvcAction): Promise<ActionResult> => ipcRenderer.invoke('svc:action', connId, unit, action),
  svcLogs: (connId: string, unit: string): Promise<string> => ipcRenderer.invoke('svc:logs', connId, unit),
  svcFollow: (connId: string, id: string, unit: string): Promise<void> => ipcRenderer.invoke('svc:follow', connId, id, unit),
  svcUnfollow: (id: string): Promise<void> => ipcRenderer.invoke('svc:unfollow', id),
  onSvcData: (cb: (id: string, text: string) => void) => on('svc:data', cb),
  onSvcEnd: (cb: (id: string) => void) => on('svc:end', cb),
  // 설정 내보내기·가져오기 (호스트는 main, 스니펫·테마는 화면이 넘기고 받음)
  exportSettings: (snippets: Snip[], theme: string): Promise<{ path: string; hosts: number; snippets: number; masked: number } | null> => ipcRenderer.invoke('settings:export', snippets, theme),
  importSettings: (): Promise<ImportResult> => ipcRenderer.invoke('settings:import'),
  // 기기 점검 (읽기 전용). smart=false면 SMART 생략
  healthRead: (connId: string, smart: boolean): Promise<Health> => ipcRenderer.invoke('health:read', connId, smart),
  // Docker 패널 (젯슨의 docker CLI를 SSH로 실행)
  dockerList: (connId: string): Promise<DockerData> => ipcRenderer.invoke('docker:list', connId),
  dockerAction: (connId: string, ref: string, action: DockerAction): Promise<string> => ipcRenderer.invoke('docker:action', connId, ref, action),
  dockerLogs: (connId: string, ref: string): Promise<string> => ipcRenderer.invoke('docker:logs', connId, ref),

  // 젯슨 화면 뷰어 (noVNC가 쓰는 바이트 통로 + 꺼져 있을 때 켜는 방법 안내)
  vncOpen: (connId: string, hostId: string, id: string): Promise<void> => ipcRenderer.invoke('vnc:open', connId, hostId, id),
  vncSend: (id: string, data: Uint8Array) => ipcRenderer.send('vnc:send', id, data),
  vncClose: (id: string) => ipcRenderer.send('vnc:close', id),
  vncGuide: (connId: string, hostId: string): Promise<Guide> => ipcRenderer.invoke('vnc:guide', connId, hostId),
  onVncData: (cb: (id: string, d: Uint8Array) => void) => on('vnc:data', cb),
  onVncClose: (cb: (id: string) => void) => on('vnc:close', cb),

  setLang: (l: string) => ipcRenderer.send('lang:set', l),
  reloadApp: () => ipcRenderer.send('app:reload'),

  // X11 화면: 이 PC에 X 서버가 떠 있는지
  x11Check: (): Promise<boolean> => ipcRenderer.invoke('x11:check'),

  // 카메라 미리보기 (Device의 gst-launch로 JPEG 프레임을 받음)
  camList: (connId: string): Promise<CamList> => ipcRenderer.invoke('cam:list', connId),
  camStart: (connId: string, id: string, path: string, fourcc: string, w: number, h: number, fps: number): Promise<void> => ipcRenderer.invoke('cam:start', connId, id, path, fourcc, w, h, fps),
  camStop: (id: string) => ipcRenderer.send('cam:stop', id),
  onCamFrame: (cb: (id: string, d: Uint8Array) => void) => on('cam:frame', cb),
  onCamEnd: (cb: (id: string, err: string) => void) => on('cam:end', cb),

  // 빌드 도구 (colcon·catkin_make): 출력은 build:data로 흘러오고 끝나면 build:end
  buildWorkspaces: (connId: string): Promise<string[]> => ipcRenderer.invoke('build:workspaces', connId),
  buildStart: (connId: string, id: string, kind: BuildKind, dir: string, symlink: boolean, packages: string): Promise<void> => ipcRenderer.invoke('build:start', connId, id, kind, dir, symlink, packages),
  buildStop: (id: string): Promise<void> => ipcRenderer.invoke('build:stop', id),
  onBuildData: (cb: (id: string, text: string) => void) => on('build:data', cb),
  onBuildEnd: (cb: (id: string) => void) => on('build:end', cb),

  // ROS2 도구
  rosList: (connId: string): Promise<RosList> => ipcRenderer.invoke('ros:list', connId),
  rosInfo: (connId: string, kind: 'topic' | 'node', name: string): Promise<string> => ipcRenderer.invoke('ros:info', connId, kind, name),
  rosLaunches: (connId: string): Promise<Launch[]> => ipcRenderer.invoke('ros:launches', connId),
  rosStream: (connId: string, id: string, kind: 'echo' | 'hz', topic: string): Promise<void> => ipcRenderer.invoke('ros:stream', connId, id, kind, topic),
  rosServices: (connId: string): Promise<Service[]> => ipcRenderer.invoke('ros:services', connId),
  rosIface: (connId: string, type: string): Promise<{ text: string; template: string }> => ipcRenderer.invoke('ros:iface', connId, type),
  rosCall: (connId: string, name: string, type: string, yaml: string): Promise<string> => ipcRenderer.invoke('ros:call', connId, name, type, yaml),
  rosParams: (connId: string, node: string): Promise<Param[]> => ipcRenderer.invoke('ros:params', connId, node),
  rosParamSet: (connId: string, node: string, name: string, value: string): Promise<string> => ipcRenderer.invoke('ros:paramSet', connId, node, name, value),
  rosBags: (connId: string): Promise<Bag[]> => ipcRenderer.invoke('ros:bags', connId),
  rosBagInfo: (connId: string, path: string): Promise<string> => ipcRenderer.invoke('ros:bagInfo', connId, path),
  rosStop: (id: string): Promise<void> => ipcRenderer.invoke('ros:stop', id),
  onRosData: (cb: (id: string, text: string) => void) => on('ros:data', cb),
  onRosEnd: (cb: (id: string) => void) => on('ros:end', cb),
  // 윈도우 탐색기에서 끌어다 놓은 파일의 실제 경로 (Electron 32+는 File.path가 없음)
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  onSessionData: (cb: (termId: string, data: string) => void) => on('session:data', cb),
  onSessionClosed: (cb: (id: string, reason: string) => void) => on('session:closed', cb),
  onTermClosed: (cb: (termId: string) => void) => on('term:closed', cb),
  onMonitor: (cb: (connId: string, e: MonitorEvent) => void) => on('monitor', cb),
  onUpdate: (cb: (s: UpdateState) => void) => on('update', cb),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),

  // Claude(MCP) 연결
  mcpInfo: (): Promise<{ command: string; args: string[]; persists: boolean }> => ipcRenderer.invoke('mcp:info'),
  mcpStatus: (): Promise<string[]> => ipcRenderer.invoke('mcp:status'),
  onMcpOpen: (cb: (r: { id: string; hostId: string }) => void) => on('mcp:open', cb),
  onMcpApprove: (cb: (a: { id: string; host: string; command: string; reason: string; kind?: 'terminal' }) => void) => on('mcp:approve', cb),
  mcpAnswer: (id: string, ok: boolean) => ipcRenderer.send('mcp:answer', id, ok)
}

// main → 화면 이벤트 구독. 반환값을 호출하면 구독 해제
function on<A extends unknown[]>(channel: string, cb: (...args: A) => void) {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
