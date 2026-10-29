// MCP 오토파일럿(전문가) 모드: 위험한 명령 대화형 승인 팝업 생략
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { dangerous } from './danger.mts'

let autopilot = false // 안전한 기본값: 꺼짐

// 환경 변수 JETDECK_AUTOPILOT 감지: 1/true면 true, 0/false면 false, 미설정이면 undefined
export function checkInitialAutopilot(env: NodeJS.ProcessEnv = process.env): boolean | undefined {
  const v = env.JETDECK_AUTOPILOT?.trim().toLowerCase()
  if (v === '1' || v === 'true') return true
  if (v === '0' || v === 'false') return false
  return undefined
}

export function isAutopilot(): boolean {
  return autopilot
}

export function setAutopilot(enabled: boolean): boolean {
  autopilot = !!enabled
  return autopilot
}

// 오토파일럿 설정 로드 우선순위: CLI 스위치 > 환경 변수 > 설정 파일(autopilot.json) > 기본값(false)
export function loadAutopilotConfig(
  filePath?: string,
  env: NodeJS.ProcessEnv = process.env,
  cliHasSwitch?: (sw: string) => boolean
): boolean {
  if (cliHasSwitch?.('no-autopilot')) return false
  if (cliHasSwitch?.('autopilot')) return true

  const envVal = checkInitialAutopilot(env)
  if (envVal !== undefined) return envVal

  if (filePath) {
    try {
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, 'utf8'))
        const val = data?.autopilot ?? data?.enabled
        if (val === true || val === 'true' || val === 1) return true
        if (val === false || val === 'false' || val === 0) return false
      }
    } catch {}
  }
  return false
}

// 오토파일럿 상태 저장 (0o600 권한)
export function saveAutopilotConfig(filePath: string, enabled: boolean): void {
  const tmpPath = `${filePath}.${process.pid}.tmp`
  try {
    const dir = dirname(filePath)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(tmpPath, JSON.stringify({ autopilot: enabled, enabled }, null, 2), { mode: 0o600 })
    try {
      chmodSync(tmpPath, 0o600)
    } catch {}
    renameSync(tmpPath, filePath)
  } catch (e) {
    try {
      rmSync(tmpPath, { force: true })
    } catch {}
    console.error('오토파일럿 상태 저장 실패:', (e as Error).message)
  }
}

// 명령 실행 전 사용자 승인 이유를 반환 (승인 불필요 시 null)
// 오토파일럿 모드가 켜져 있으면 위험 명령이어도 승인을 요구하지 않음 (null 반환)
export function getApprovalReason(command: string, enabled = autopilot): string | null {
  if (enabled) return null
  return dangerous(command)
}

// 명령 실행 전 사용자 승인(팝업)이 필요한지 판별
export function requiresApproval(command: string, enabled = autopilot): boolean {
  return getApprovalReason(command, enabled) !== null
}
