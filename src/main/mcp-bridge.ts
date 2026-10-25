import { app } from 'electron'
import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { Socket } from 'net'
import { join } from 'path'
import { createInterface } from 'readline'
import { appExe, INSTRUCTIONS, mcpFile, TOOLS } from './mcp'

// `JetDeck.exe --mcp`: Claude Desktop·Claude Code가 실행하는 MCP 서버(stdio, JSON-RPC 한 줄씩).
// 창 없이 떠서 요청을 켜 둔 JetDeck(mcp.ts의 127.0.0.1 서버)로 넘김. JetDeck이 꺼져 있으면 켜고 기다림
let infoFile = '' // 본 앱이 주소·토큰을 적어 두는 mcp.json (mcp.ts의 mcpFile, runBridge에서 정함)
type Info = { port: number; token: string; pid: number }

function readInfo(): Info | null {
  try {
    const i = JSON.parse(readFileSync(infoFile, 'utf8')) as Info
    process.kill(i.pid, 0) // 그 JetDeck이 아직 살아 있는지 (없으면 예외)
    return i
  } catch {
    return null
  }
}

async function post(i: Info, name: string, args: unknown): Promise<{ text: string; isError?: boolean }> {
  const r = await fetch(`http://127.0.0.1:${i.port}/call`, {
    method: 'POST',
    headers: { authorization: `Bearer ${i.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name, arguments: args, pid: process.pid }) // pid: 어느 AI 도구가 불렀는지 기록하려고
  })
  if (!r.ok) throw new Error(`JetDeck이 요청을 거부했어요 (${r.status})`)
  return (await r.json()) as { text: string; isError?: boolean }
}

let launching: Promise<Info> | null = null
async function ensureApp(): Promise<Info> {
  const now = readInfo()
  if (now) return now
  launching ??= (async () => {
    // 창이 있는 보통 JetDeck을 따로 띄움 (이 브리지가 끝나도 계속 켜져 있게 분리)
    // Windows: 이 브리지가 Store판 Claude 안에서 돌면 자식 프로세스도 %APPDATA%를 가짜 복사본으로 보게 되므로, 탐색기에 시켜 따로 띄움
    if (process.platform === 'win32' && app.isPackaged) spawn('explorer.exe', [appExe()], { detached: true, stdio: 'ignore' }).unref()
    else spawn(appExe(), app.isPackaged ? [] : [app.getAppPath()], { detached: true, stdio: 'ignore' }).unref()
    for (let k = 0; k < 60; k++) {
      await new Promise((r) => setTimeout(r, 500))
      const i = readInfo()
      if (i) return i
    }
    throw new Error('JetDeck을 켜지 못했어요. JetDeck을 직접 실행한 뒤 다시 시도해 주세요')
  })().finally(() => (launching = null))
  return launching
}

// 본체에 "이 프로그램이 접속했다"를 알림 (화면의 연결 불). 본체가 재시작해 토큰이 바뀌면 다시 알림
let clientName = 'MCP'
let announced = ''
function announce(i: Info): void {
  if (announced === i.token) return
  announced = i.token
  post(i, '__hello', { client: clientName, pid: process.pid }).catch(() => (announced = ''))
}

async function callTool(name: string, args: unknown): Promise<{ text: string; isError?: boolean }> {
  const i = await ensureApp()
  announce(i)
  try {
    return await post(i, name, args)
  } catch {
    return post(await ensureApp(), name, args) // JetDeck이 방금 재시작했으면 새 주소로 한 번 더
  }
}

type Req = { jsonrpc: '2.0'; id?: number | string; method: string; params?: Record<string, unknown> }
const write = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + '\n')

async function handle(m: Req): Promise<void> {
  const reply = (result: unknown) => m.id !== undefined && write({ jsonrpc: '2.0', id: m.id, result })
  switch (m.method) {
    case 'initialize': {
      const n = (m.params?.clientInfo as { name?: unknown } | undefined)?.name
      if (typeof n === 'string' && n) clientName = n
      const now = readInfo() // 꺼져 있으면 일부러 켜지 않음 (첫 도구 호출 때 알림)
      if (now) announce(now)
      return void reply({
        protocolVersion: typeof m.params?.protocolVersion === 'string' ? m.params.protocolVersion : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'jetdeck', version: app.getVersion() },
        instructions: INSTRUCTIONS
      })
    }
    case 'ping':
      return void reply({})
    case 'tools/list':
      return void reply({ tools: TOOLS })
    case 'tools/call': {
      let r: { text: string; isError?: boolean }
      try {
        r = await callTool(String(m.params?.name), m.params?.arguments ?? {})
      } catch (e) {
        r = { text: (e as Error).message, isError: true }
      }
      return void reply({ content: [{ type: 'text', text: r.text }], isError: !!r.isError })
    }
  }
  // 알림(id 없음)은 무시, 모르는 요청은 오류로 답함
  if (m.id !== undefined) write({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `지원하지 않는 요청: ${m.method}` } })
}

export function runBridge(): void {
  app.disableHardwareAcceleration()
  // index.ts가 정한 본 앱 데이터 폴더에서 mcp.json을 읽고, 크롬 프로필 폴더는 본 앱과 겹치지 않게 그 아래 따로
  const main = app.getPath('userData')
  infoFile = mcpFile()
  app.setPath('userData', join(main, 'mcp-bridge'))
  // Windows의 Electron main에선 process.stdin이 바로 닫혀 버림 → 표준 입력(fd 0) 파이프를 소켓으로 직접 읽음
  const rl = createInterface({ input: new Socket({ fd: 0, readable: true, writable: false }) })
  rl.on('line', (line) => {
    if (!line.trim()) return
    let m: Req
    try {
      m = JSON.parse(line)
    } catch {
      return void write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 형식 오류' } })
    }
    handle(m).catch((e) => m.id !== undefined && write({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: (e as Error).message } }))
  })
  rl.on('close', () => app.quit()) // Claude가 연결을 끊으면 브리지도 끝
  // JetDeck이 재시작(업데이트 등)돼 새 주소가 생기면 1초 안에 다시 알려, 연결 불이 꺼진 채로 남지 않게
  setInterval(() => {
    const i = readInfo()
    if (i) announce(i)
  }, 1000)
}
