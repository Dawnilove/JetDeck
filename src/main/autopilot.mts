// MCP 오토파일럿(전문가) 모드: 위험한 명령 대화형 승인 팝업 생략
import { dangerous } from './danger.mts'

let autopilot = false // 안전한 기본값: 꺼짐

// 환경 변수 JETDECK_AUTOPILOT=1 또는 true로 초기화 가능
export function checkInitialAutopilot(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.JETDECK_AUTOPILOT?.trim().toLowerCase()
  return v === '1' || v === 'true'
}

export function isAutopilot(): boolean {
  return autopilot
}

export function setAutopilot(enabled: boolean): boolean {
  autopilot = !!enabled
  return autopilot
}

// 명령 실행 전 사용자 승인(팝업)이 필요한지 판단
// 오토파일럿 모드가 켜져 있으면 위험 명령이어도 승인이 필요하지 않음 (자동 승인)
export function requiresApproval(command: string, enabled = autopilot): boolean {
  if (enabled) return false
  return dangerous(command) !== null
}
