import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Client } from 'ssh2'
import type { Socket } from 'net'
import { forwardOut } from './fwdout.mts'

test('6.1.2 #9 콜백 전에 소켓이 닫혔으면 채널을 닫고 ok를 부르지 않음', () => {
  let closed = 0
  let okCalls = 0
  const stream = { destroy: () => closed++ }
  const client = { forwardOut: (_a: string, _b: number, _c: string, _d: number, f: (e: Error | undefined, s: unknown) => void) => f(undefined, stream) } as unknown as Client
  forwardOut(client, { destroyed: true, remotePort: 1, destroy() {} } as unknown as Socket, 'h', 1, () => okCalls++)
  assert.equal(closed, 1)
  assert.equal(okCalls, 0)
  forwardOut(client, { destroyed: false, remotePort: 1, destroy() {} } as unknown as Socket, 'h', 1, () => okCalls++)
  assert.equal(closed, 1)
  assert.equal(okCalls, 1)
})
