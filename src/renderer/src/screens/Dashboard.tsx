import { useEffect, useState } from 'react'
import type { HostInfo } from '../../../main/store'
import type { Stats } from '../../../main/tegrastats.mts'
import Button from '../components/Button'
import { tr } from '../../../main/i18n.mts'
import { summarize } from './dashfmt.mts'
import type { Sess } from './Workspace'

// 여러 기기 대시보드: 저장한 SSH 기기마다 카드 하나. 이미 열린 연결의 모니터 값만 모아 보여 주고, 연결 안 된 기기는 "연결" 버튼 (새 연결은 사용자가 누를 때만)
type Props = { hosts: HostInfo[]; sessions: Sess[]; onGo: (id: string) => void; onConnect: (h: HostInfo) => void } // hosts: 연결 관리 화면이 읽은 목록 (추가·삭제가 바로 반영)

export default function Dashboard({ hosts: all, sessions, onGo, onConnect }: Props) {
  const hosts = all.filter((h) => h.kind !== 'serial')
  const [stats, setStats] = useState<Record<string, Stats>>({}) // 연결 id → 최근 값
  useEffect(() => window.api.onMonitor((id, e) => e.kind === 'stats' && setStats((m) => ({ ...m, [id]: e.stats }))), [])
  // 닫은 연결의 값은 버림 (다시 열면 새 id)
  const ids = sessions.map((s) => s.id).join()
  useEffect(() => setStats((m) => Object.fromEntries(Object.entries(m).filter(([id]) => sessions.some((s) => s.id === id)))), [ids])
  // 같은 기기에 연결이 여러 개면 연결된 것을 우선
  const sessOf = (h: HostInfo) => sessions.filter((s) => s.host.id === h.id).sort((a, b) => Number(b.status === 'online') - Number(a.status === 'online'))[0]
  const idle = hosts.filter((h) => !sessOf(h))
  if (!hosts.length) return null

  return (
    <section aria-label={tr('대시보드')} style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600 }}>{tr('대시보드')}</h2>
        {idle.length > 0 && <Button size={36} onClick={() => idle.forEach(onConnect)}>{tr('연결 안 된 {0}대 모두 연결', idle.length)}</Button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {hosts.map((h) => {
          const s = sessOf(h)
          const sum = s && stats[s.id] ? summarize(stats[s.id]) : null
          const val = (n: number | null, unit: string) => (n === null ? '–' : n + unit)
          return (
            <button
              key={h.id}
              type="button"
              className="host-item"
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, padding: 14 }}
              title={s ? tr('{0} 작업 공간으로 이동', h.name) : tr('{0}에 접속', h.name)}
              onClick={() => (s ? onGo(s.id) : onConnect(h))}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`dot dot-lg ${s?.status === 'online' ? '' : s?.status === 'connecting' ? 'connecting' : 'offline'}`} aria-hidden />
                <b style={{ fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</b>
              </span>
              {sum ? (
                <span className="mono" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12 }}>
                  <span>CPU {val(sum.cpu, '%')}</span>
                  <span>GPU {val(sum.gpu, '%')}</span>
                  <span>{tr('메모리')} {val(sum.ram, '%')}</span>
                  <span>{tr('온도')} {val(sum.temp, '°C')}</span>
                  <span>{tr('전력')} {val(sum.watt, ' W')}</span>
                </span>
              ) : (
                <span className="dim" style={{ fontSize: 12 }}>{!s ? tr('연결 안 됨 · 눌러서 연결') : s.status === 'online' ? tr('값을 읽는 중…') : s.status === 'connecting' ? tr('연결하는 중…') : tr('끊김')}</span>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}
