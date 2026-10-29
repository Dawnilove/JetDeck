import type { MonitorInfo } from '../../../main/monitor'
import type { Stats } from '../../../main/tegrastats.mts'
import Button from './Button'
import Segment from './Segment'
import { tr } from '../../../main/i18n.mts'

type Props = {
  stats: Stats | null
  info: MonitorInfo
  online: boolean
  onRun: (cmd: string) => void // sudo가 필요한 명령은 터미널에 입력해 비밀번호를 직접 받게 함
  forwards: { id: string; name: string; localPort: number }[] // 켜진 로컬 포워딩 → 클릭하면 브라우저로 열기
}

// 절전: 깨우기 설정(wol g)은 재부팅하면 풀리므로 절전 직전에 다시 켜고 들어감 (sudo 한 번)
export function suspendCommand(iface?: string): string {
  return iface && /^[\w.-]+$/.test(iface) ? `sudo sh -c 'ethtool -s ${iface} wol g; systemctl suspend'` : 'sudo systemctl suspend'
}
export const SUSPEND_ASK = tr("Device를 절전시킬까요?\n연결이 끊기고, 연결 관리 화면의 '깨우기'로 다시 켤 수 있어요. (같은 유선망에서만)")

const gb = (mb: number) => (mb / 1024).toFixed(1)
const deg = (c: number | null) => (c == null ? '-' : `${Math.round(c)}°C`)

function Meter({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div className="mon-meter">
      <div>
        <span className="dim">{label}</span>
        <span className="mono">{value}</span>
      </div>
      <div className="mon-track" role="meter" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  )
}

export default function Monitor({ stats, info, online, onRun, forwards }: Props) {
  const maxMhz = Math.max(0, ...(stats?.cpu.map((c) => c.mhz ?? 0) ?? []))
  const modes = info.modes ?? []

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ fontSize: 13, fontWeight: 600 }}>{tr('시스템 모니터')}</h2>
        <span className="dim" style={{ fontSize: 11 }}>{tr('0.5초 간격')}</span>
      </div>

      {!online ? (
        <p className="dim mon-note">{tr('연결되면 표시돼요.')}</p>
      ) : info.generic === false ? (
        <p className="dim mon-note">{tr('이 기기의 상태를 읽을 수 없어요. (/proc·/sys를 읽을 수 있는 Linux가 필요해요)')}</p>
      ) : !stats ? (
        <p className="dim mon-note">{tr('불러오는 중…')}</p>
      ) : (
        <>
          {(info.model || info.jetpack || info.cuda) && (
            <p className="dim mon-note" title={info.model}>{[info.model?.replace(/^NVIDIA /, ''), info.jetpack, info.cuda].filter(Boolean).join(' · ')}</p>
          )}
          <div className="caption">CPU · {tr('{0}코어', stats.cpu.length)}{maxMhz ? ` ${(maxMhz / 1000).toFixed(2)} GHz` : ''}</div>
          <div className="mon-cores">
            {stats.cpu.map((c, i) => (
              <div key={i} title={c.pct == null ? tr('꺼짐') : `${c.pct}%${c.mhz ? ` @ ${c.mhz} MHz` : ''}`}>
                <div className="mon-track mon-vtrack" role="meter" aria-label={`CPU ${i + 1}`} aria-valuenow={c.pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
                  <div style={{ height: `${c.pct ?? 0}%` }} />
                </div>
                <span>{c.pct == null ? 'off' : `C${i + 1}`}</span>
              </div>
            ))}
          </div>
          {stats.gpu != null && <Meter label={stats.gpuMhz ? `GPU · ${stats.gpuMhz} MHz` : 'GPU'} value={`${stats.gpu}%`} pct={stats.gpu} />}
          {stats.ram && <Meter label={stats.ramMhz ? `${tr('메모리')} · ${stats.ramMhz} MHz` : tr('메모리')} value={`${gb(stats.ram.used)} / ${gb(stats.ram.total)} GB`} pct={(stats.ram.used / stats.ram.total) * 100} />}
          {info.disk && <Meter label={tr('저장공간')} value={`${gb(info.disk.used / 1024)} / ${gb(info.disk.total / 1024)} GB`} pct={(info.disk.used / info.disk.total) * 100} />}
          <div className="mon-tiles">
            <div><span className="dim">CPU</span><span className="mono">{deg(stats.temps.cpu)}</span></div>
            {(!info.generic || stats.temps.gpu != null) && <div><span className="dim">GPU</span><span className="mono">{deg(stats.temps.gpu)}</span></div>}
            {(!info.generic || stats.temps.board != null) && <div title={stats.temps.boardName ?? ''}><span className="dim">{tr('보드')}</span><span className="mono">{deg(stats.temps.board)}</span></div>}
          </div>
          {stats.powerMw != null && (
            <div className="mon-row">
              <span className="dim">{tr('소비 전력')}</span>
              <span className="mono">{(stats.powerMw / 1000).toFixed(1)} W</span>
            </div>
          )}
        </>
      )}

      {online && forwards.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="caption">{tr('포워딩 중')}</span>
          {forwards.map((f) => (
            <a key={f.id} className="mon-fwd" href={`http://localhost:${f.localPort}`} target="_blank" rel="noreferrer">
              <span>{f.name}</span>
              <span className="mono">:{f.localPort}</span>
            </a>
          ))}
        </div>
      )}

      {online && modes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="caption">{tr('전원 모드')}</span>
          {/* 보드에서 읽은 모드 목록. 고르면 터미널에 sudo nvpmodel 명령 입력 */}
          <Segment
            label={tr('전원 모드')}
            value={String(info.mode?.id ?? '')}
            onChange={(v) => {
              const m = modes.find((x) => String(x.id) === v)!
              if (confirm(tr('전원 모드를 {0}(으)로 바꿀까요?\n터미널에서 sudo 비밀번호를 물어볼 수 있고, 모드에 따라 재부팅을 요청할 수 있어요.', m.name))) onRun(`sudo nvpmodel -m ${m.id}`)
            }}
            options={modes.map((m) => ({ value: String(m.id), label: m.name }))}
          />
        </div>
      )}

      {online && (
        <div className="mon-actions">
          <Button size={36} onClick={() => confirm(SUSPEND_ASK) && onRun(suspendCommand(info.wake?.iface))}>{tr('절전')}</Button>
          <Button variant="warn" size={36} onClick={() => confirm(tr('Device를 재부팅할까요? 연결이 끊겨요.')) && onRun('sudo reboot')}>{tr('재부팅')}</Button>
          <Button variant="warn" size={36} onClick={() => confirm(tr('Device를 종료할까요? 다시 켜려면 전원을 직접 눌러야 해요.')) && onRun('sudo poweroff')}>{tr('전원 끄기')}</Button>
        </div>
      )}
    </>
  )
}
