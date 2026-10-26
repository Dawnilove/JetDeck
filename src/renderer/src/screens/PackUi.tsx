import { getLang, tr } from '../../../main/i18n.mts'
import type { CommandDiff } from '../../../main/packstore.mts'
import { summarizePack, type L10n, type Pack, type PackAction, type Risk } from '../../../main/packschema.mts'
import { REASON_TEXT } from '../../../main/risk.mts'

// 플러그인 관리·허용 창·팩 화면이 같이 쓰는 조각들
export const lt = (l: L10n) => l[getLang()]
export const RISK_TEXT: Record<Risk, string> = { read: tr('읽기'), change: tr('바꿈'), danger: tr('위험') }
const RISK_COLOR: Record<Risk, string> = { read: 'var(--status-on)', change: 'var(--warn)', danger: 'var(--status-off)' }

export const RiskTag = ({ risk }: { risk: Risk }) => (
  <span className="tag" style={{ color: RISK_COLOR[risk], borderColor: RISK_COLOR[risk], fontWeight: 600 }}>{RISK_TEXT[risk]}</span>
)

// 앱이 계산한 위험 이유 (앱 글자). 팩이 쓴 글자가 아님
export const Reasons = ({ a }: { a: Pick<PackAction, 'reasons' | 'understated' | 'declared'> }) => (
  <>
    {a.understated && <p className="msg-err" style={{ fontSize: 12 }}>⚠ {tr('읽기라고 적혀 있지만 실제로는 읽기가 아니에요')}</p>}
    {a.reasons.length > 0 && (
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }} className="dim">
        {a.reasons.map((r) => <li key={r}>{tr(REASON_TEXT[r])}</li>)}
      </ul>
    )}
  </>
)

export const cmdOf = (a: PackAction, values?: Record<string, string>) => {
  const c = values ? a.cmd.replace(/\{(\w+)\}/g, (_m, n: string) => values[n] ?? `{${n}}`) : a.cmd
  return (a.sudo ? 'sudo ' : '') + c
}

const fmtSize = (n: number) => (n < 1024 ? `${n}B` : `${(n / 1024).toFixed(1)}KB`)

// 허용 창·설치 확인·"내용 보기"가 같이 쓰는 본문: 머리말(작성자·버전·크기·지문·항목 수) + 모든 항목의 명령 전문
// 숨김(이 앱이 모르는 방식)·젯슨 전용 항목도 숨기지 않고 표시만 달리 함: 실제로 켜진 뒤 다른 환경에서 실행될 수 있어서 명령은 다 보여 줌
export function PackBody({ pack, hash, size, changes }: { pack: Pack; hash: string; size: number; changes?: CommandDiff }) {
  const s = summarizePack(pack)
  const mark = (pl: string, a: string) => (changes?.added.includes(`${pl}/${a}`) ? tr('새로 추가됨') : changes?.changed.includes(`${pl}/${a}`) ? tr('명령이 바뀜') : '')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      <p className="dim mono" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
        {[pack.author && `${tr('작성자')} ${pack.author}`, `v${pack.version}`, fmtSize(size), `${tr('지문')} ${hash.slice(0, 8)}`, pack.license, pack.homepage].filter(Boolean).join(' · ')}
      </p>
      {pack.desc && <p style={{ fontSize: 13 }}>{lt(pack.desc)}</p>}
      <p style={{ fontSize: 13 }}>
        {tr('항목 {0}개: 읽기 {1} · 바꿈 {2} · 위험 {3}', s.total, s.read, s.change, s.danger)}
        {s.terminal > 0 && ` · ${tr('터미널 입력 {0}', s.terminal)}`}
      </p>
      {s.understated > 0 && <p className="msg-err" style={{ fontSize: 13 }}>⚠ {tr('{0}개는 적힌 위험도가 부정확해요 (읽기라고 적혀 있지만 아니에요)', s.understated)}</p>}
      {s.hidden > 0 && <p className="dim" style={{ fontSize: 13 }}>{tr('{0}개는 새 버전 앱이 필요해서 지금은 쓸 수 없어요', s.hidden)}</p>}
      {changes && changes.removed.length > 0 && <p className="dim" style={{ fontSize: 12 }}>{tr('빠진 항목')}: {changes.removed.join(', ')}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: '38vh', paddingRight: 4 }}>
        {pack.plugins.map((pl) => (
          <div key={pl.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="caption">{lt(pl.title)}</span>
            {pl.actions.map((a) => (
              <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, borderRadius: 8, background: 'var(--bg)', border: mark(pl.id, a.id) ? '1px solid var(--warn)' : '1px solid transparent' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13 }}>
                  <RiskTag risk={a.risk} />
                  <strong>{lt(a.label)}</strong>
                  {a.mode === 'terminal' && <span className="tag">{tr('터미널 입력')}</span>}
                  {a.when === 'jetson' && <span className="tag">{tr('Jetson에서만 표시')}</span>}
                  {a.hidden && <span className="tag">{tr('새 버전 앱이 필요해요')}</span>}
                  {mark(pl.id, a.id) && <span className="tag" style={{ color: 'var(--warn)', borderColor: 'var(--warn)' }}>{mark(pl.id, a.id)}</span>}
                </div>
                <code className="mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{cmdOf(a)}</code>
                {a.preview && <code className="mono dim" style={{ fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{tr('미리보기')}: {a.preview}</code>}
                {a.params?.map((p) => (
                  <span key={p.name} className="dim mono" style={{ fontSize: 12 }}>{`{${p.name}}`} = {p.choices.map((c) => c.value).join(' | ')}</span>
                ))}
                <Reasons a={a} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
