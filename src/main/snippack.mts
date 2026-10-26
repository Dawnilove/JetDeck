// 스니펫 → 팩 내보내기 (5.0.0): 스니펫 저장소는 그대로 두고 mode:"terminal" 항목의 팩 파일 텍스트만 만든다. Electron 없이 시험
import { redact } from './activitylog.mts'
import type { Snip } from './settingsio.mts'
import { LIMITS } from './packschema.mts'
import { analyze } from './risk.mts'

const MAX = 50 // 플러그인당 항목 상한

export function buildSnippetPack(snips: Snip[], version: string): { text: string; exported: number; skipped: number; masked: number } {
  let skipped = 0
  let masked = 0
  const actions: Record<string, unknown>[] = []
  for (const s of snips) {
    const cmd = redact(String(s.cmd ?? '')).replace(/\r\n?/g, '\n').trim()
    if (cmd !== String(s.cmd ?? '').replace(/\r\n?/g, '\n').trim()) masked++
    if (!cmd || actions.length >= MAX || cmd.length > LIMITS.cmd || cmd.split('\n').length > LIMITS.terminalLines || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(cmd)) {
      skipped++
      continue
    }
    const risk = analyze(cmd).risk // 위험도는 앱이 계산 (팩 파일에 적은 값은 참고용)
    const a: Record<string, unknown> = { id: `snippet-${actions.length + 1}`, label: String(s.name || cmd.split('\n')[0]).slice(0, LIMITS.name), mode: 'terminal', cmd, risk }
    if (s.enter === false) a.enter = false
    if (risk !== 'read') a.confirm = '이 명령을 터미널에 입력해요. 내용을 확인하세요. / This types the command into the terminal. Check it first.'
    actions.push(a)
  }
  const pack = {
    id: 'my-snippets',
    format: 1,
    version: '1.0.0',
    name: '내 스니펫 / My snippets',
    desc: `JetDeck ${version} 스니펫에서 내보냈어요. / Exported from JetDeck snippets.`,
    plugins: [{ id: 'snippets', title: '스니펫 / Snippets', actions }]
  }
  return { text: JSON.stringify(pack, null, 2) + '\n', exported: actions.length, skipped, masked }
}
