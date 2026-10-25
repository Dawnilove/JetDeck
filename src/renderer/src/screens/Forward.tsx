import { useState } from 'react'
import type { Rule } from '../../../main/forward'
import Button from '../components/Button'
import Input from '../components/Input'
import Segment from '../components/Segment'
import Switch from '../components/Switch'
import { errText } from '../util'
import { tr } from '../../../main/i18n.mts'
import { sshCommand } from './uifmt.mts'

// 포트 포워딩 화면 (design/PortForward.dc.html): 왼쪽 규칙 표, 오른쪽 규칙 추가
export type FwdRule = Rule & { active: boolean; error?: string }
type Props = {
  rules: FwdRule[]
  online: boolean
  target: string // ssh 명령 미리보기용 user@host
  onAdd: (r: Partial<Rule>) => Promise<void>
  onToggle: (id: string, on: boolean) => Promise<void>
  onDelete: (id: string) => void
}

const KIND = { L: tr('로컬'), R: tr('원격'), D: tr('동적') }
const PRESETS = [
  { name: 'Jupyter Lab', port: 8888 },
  { name: 'TensorBoard', port: 6006 },
  { name: 'rosbridge', port: 9090 },
  { name: tr('VNC 원격 화면'), port: 5900 },
  { name: 'Flask', port: 5000 }
]


export default function Forward({ rules, online, target, onAdd, onToggle, onDelete }: Props) {
  const [kind, setKind] = useState<Rule['kind']>('L')
  const [name, setName] = useState('')
  const [lp, setLp] = useState('')
  const [rp, setRp] = useState('')
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const activeCount = rules.filter((r) => r.active).length

  const add = async () => {
    setBusy(true)
    try {
      await onAdd({ kind, name, localPort: Number(lp), remotePort: Number(rp) })
      setMsg({ text: tr("'{0}' 포워딩을 시작했어요", name), ok: true })
      setName('')
      setLp('')
      setRp('')
    } catch (e) {
      setMsg({ text: errText(e), ok: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fw">
      <section className="fw-rules" aria-label={tr('포워딩 규칙')}>
        <div className="fw-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ fontSize: 18, fontWeight: 600 }}>{tr('포워딩 규칙')}</h1>
            <p className="dim" style={{ fontSize: 13 }}>{tr('Device에서 돌아가는 웹 서비스를 내 PC 브라우저에서 열 수 있어요.')}</p>
          </div>
          <span className="dim" style={{ fontSize: 13 }}>{tr('{0}개 활성', activeCount)}</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 640 }}>
            <div className="fw-row fw-th">
              <span>{tr('이름')}</span><span>{tr('종류')}</span><span>{tr('내 PC')}</span><span>{tr('Device 쪽 대상')}</span><span style={{ textAlign: 'right' }}>{tr('상태')}</span>
            </div>
            {rules.map((r) => (
              <div key={r.id} className="fw-row">
                <span style={{ fontWeight: 500 }}>
                  {r.name}
                  {r.error && <span className="msg-err fw-err">{r.error}</span>}
                </span>
                <span className="dim" style={{ fontSize: 12 }}>{KIND[r.kind]}</span>
                <span className="mono" style={{ fontSize: 13 }}>{r.kind === 'D' ? `SOCKS5 localhost:${r.localPort}` : `localhost:${r.localPort}`}</span>
                <span className="mono" style={{ fontSize: 13, color: 'var(--text-soft)' }}>{r.kind === 'D' ? tr('요청에 따라') : `localhost:${r.remotePort}`}</span>
                <span className="fw-state">
                  {/* 로컬 포워딩이 켜져 있으면 기본 브라우저로 열기 (main의 창 열기 처리기가 외부 브라우저로 보냄) */}
                  {r.active && r.kind === 'L' && (
                    <a href={`http://localhost:${r.localPort}`} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>{tr('열기')}</a>
                  )}
                  <Switch
                    label={r.name}
                    checked={r.active}
                    onChange={(on) => online && onToggle(r.id, on).catch((e) => setMsg({ text: errText(e), ok: false }))}
                  />
                  <button type="button" className="ed-x" aria-label={tr('{0} 규칙 삭제', r.name)} title={tr('규칙 삭제')} onClick={() => confirm(tr("'{0}' 규칙을 삭제할까요?", r.name)) && onDelete(r.id)}>×</button>
                </span>
              </div>
            ))}
            {rules.length === 0 && <p className="dim fw-empty">{tr('아직 규칙이 없어요. 오른쪽에서 추가하세요.')}</p>}
          </div>
        </div>
      </section>

      <section className="card card-sm fw-add" aria-label={tr('규칙 추가')}>
        <h2>{tr('규칙 추가')}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="dim" style={{ fontSize: 13 }}>{tr('종류')}</span>
          <Segment
            label={tr('포워딩 종류')}
            value={kind}
            onChange={setKind}
            options={[{ value: 'L', label: tr('로컬 (-L)') }, { value: 'R', label: tr('원격 (-R)') }, { value: 'D', label: tr('동적 (-D)') }]}
          />
          <p className="dim" style={{ fontSize: 12 }}>
            {kind === 'L' ? tr('Device의 서비스를 내 PC에서 열 때 (가장 많이 씀)') : kind === 'R' ? tr('내 PC의 서비스를 Device에서 쓸 때') : tr('브라우저 프록시로 Device 쪽 네트워크를 통째로 쓸 때')}
          </p>
        </div>
        <Input label={tr('이름')} placeholder={tr('예: Jupyter Lab')} value={name} onChange={(e) => setName(e.target.value)} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <Input label={tr('내 PC 포트')} mono inputMode="numeric" placeholder="8888" value={lp} onChange={(e) => setLp(e.target.value)} />
          <Input label={tr('Device 포트')} mono inputMode="numeric" placeholder={kind === 'D' ? tr('필요 없음') : '8888'} disabled={kind === 'D'} value={kind === 'D' ? '' : rp} onChange={(e) => setRp(e.target.value)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="dim" style={{ fontSize: 12 }}>{tr('자주 쓰는 포트')}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {PRESETS.map((p) => (
              <button
                key={p.port}
                type="button"
                className="fw-chip"
                onClick={() => {
                  setKind('L')
                  setName(p.name)
                  setLp(String(p.port))
                  setRp(String(p.port))
                }}
              >
                {p.name.split(' ')[0]} {p.port}
              </button>
            ))}
          </div>
        </div>
        <div className="fw-cmd mono">{sshCommand(kind, lp, rp, target)}</div>
        {msg && <p role="status" className={msg.ok ? 'msg-ok' : 'msg-err'} style={{ fontSize: 13 }}>{msg.text}</p>}
        <Button variant="primary" onClick={add} disabled={!online || busy || !name.trim() || !lp || (kind !== 'D' && !rp)}>
          {tr('추가하고 시작')}
        </Button>
      </section>
    </div>
  )
}
