import { useEffect, useRef, useState } from 'react'
import { alertsOf, TEMP_WARN, WIFI_WEAK, type Health } from '../../../main/healthparse.mts'
import Button from '../components/Button'
import PanelHead, { Desc, Note } from '../components/PanelHead'
import { errText } from '../util'
import { tr } from '../../../main/i18n.mts'

// 기기 점검: 온도·Wi-Fi 신호·디스크 SMART·실패한 서비스. Device에는 설치하는 것이 없고 읽기만 함
const POLL_MS = 60_000

export type HealthState = { data: Health | null; busy: boolean; error: string; check: () => void }

// 작업 공간이 항상 쓰는 훅: 연결된 동안 1분마다 읽어(SMART 제외) 새 경고가 생기면 알림. 점검 화면은 이 값을 보여 주기만 함
export function useHealth(connId: string, online: boolean, hostName: string): HealthState {
  const [data, setData] = useState<Health | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const seen = useRef(new Set<string>())
  const last = useRef<Health | null>(null)

  const read = async (smart: boolean) => {
    setBusy(true)
    try {
      const h = await window.api.healthRead(connId, smart)
      // 자동 점검은 SMART를 건너뛰므로 마지막 SMART 결과를 유지
      if (!smart && last.current) h.smart = last.current.smart
      last.current = h
      setData(h)
      setError('')
      const now = alertsOf(h)
      for (const a of now) {
        if (seen.current.has(a.key)) continue
        seen.current.add(a.key)
        try {
          new Notification(tr('{0} 점검 경고', hostName), { body: a.text })
        } catch {
          /* 알림을 못 띄워도 점검 화면에는 보임 */
        }
      }
      const keys = new Set(now.map((a) => a.key))
      for (const k of [...seen.current]) if (!keys.has(k)) seen.current.delete(k) // 해결되면 다시 나빠질 때 또 알림
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    if (!online) {
      last.current = null
      return
    }
    read(true)
    const t = setInterval(() => read(false), POLL_MS)
    return () => clearInterval(t)
  }, [online, connId])
  return { data, busy, error, check: () => read(true) }
}

const SMART_TEXT = { ok: tr('정상'), fail: tr('경고 — 디스크 이상'), noperm: tr('sudo 권한 필요'), unsupported: tr('SMART 미지원 (eMMC·SD 카드 등)') }

export default function HealthView({ online, state }: { online: boolean; state: HealthState }) {
  const { data, busy, error, check } = state
  const alerts = data ? alertsOf(data) : []
  const row = (k: string, v: string, bad = false) => (
    <div key={k} style={{ display: 'flex', gap: 12, padding: '4px 0', fontSize: 13 }}>
      <span className="mono" style={{ minWidth: 160 }}>{k}</span>
      <span className={bad ? 'msg-err' : 'dim'}>{v}</span>
    </div>
  )
  return (
    <div className="fw">
      <section className="fw-rules ros-list" aria-label={tr('기기 점검')} style={{ flex: 1 }}>
        <PanelHead title={tr('기기 점검')} desc={<Desc>{tr('온도·Wi-Fi·디스크·실패한 서비스를 읽기만 해요. 연결된 동안 1분마다 확인하고 문제가 생기면 알려 줘요.')}</Desc>}>
          <Button size={36} onClick={check} disabled={!online || busy}>{busy ? tr('읽는 중…') : tr('지금 점검')}</Button>
        </PanelHead>
        <div className="ros-items" style={{ padding: '8px 20px' }}>
          {!online && <Note>{tr('연결되면 점검해요.')}</Note>}
          {online && error && <Note err>{error}</Note>}
          {online && !data && !error && <Note>{tr('읽는 중…')}</Note>}
          {online && data && (
            <>
              {alerts.length > 0 && (
                <div className="callout" style={{ flexDirection: 'column', gap: 4, margin: '4px 0 12px' }} role="alert">
                  {alerts.map((a) => <b key={a.key}>{a.text}</b>)}
                </div>
              )}
              <h2 style={{ margin: '8px 0 4px' }}>{tr('온도')}</h2>
              {data.temps.length ? data.temps.map((t) => row(t.name, `${t.c.toFixed(1)}℃`, t.c >= TEMP_WARN)) : <p className="dim" style={{ fontSize: 13 }}>{tr('온도 센서를 찾지 못했어요.')}</p>}
              <h2 style={{ margin: '14px 0 4px' }}>Wi-Fi</h2>
              {data.wifi.length ? data.wifi.map((w) => row(`${w.iface}${data.ssid ? ` (${data.ssid})` : ''}`, `${w.dbm} dBm · ${w.quality}%${w.dbm <= WIFI_WEAK ? ` — ${tr('신호가 약해요')}` : ''}`, w.dbm <= WIFI_WEAK)) : <p className="dim" style={{ fontSize: 13 }}>{tr('Wi-Fi 연결이 없어요 (유선이거나 무선 장치 없음).')}</p>}
              <h2 style={{ margin: '14px 0 4px' }}>{tr('디스크 SMART')}</h2>
              {data.smart.state === 'ok' && data.smart.disks.map((d) => row(d.name, SMART_TEXT[d.result], d.result === 'fail'))}
              {data.smart.state === 'ok' && !data.smart.disks.length && <p className="dim" style={{ fontSize: 13 }}>{tr('디스크를 찾지 못했어요.')}</p>}
              {data.smart.state === 'nosmartctl' && <p className="dim" style={{ fontSize: 13 }}>{tr('Device에 smartctl이 없어서 SMART는 볼 수 없어요. JetDeck은 설치하지 않아요. 필요하면 Device에 smartmontools를 직접 설치하세요.')}</p>}
              {data.smart.state === 'skipped' && <p className="dim" style={{ fontSize: 13 }}>{tr('"지금 점검"을 누르면 SMART도 읽어요.')}</p>}
              <h2 style={{ margin: '14px 0 4px' }}>{tr('실패한 서비스')}</h2>
              {data.failed.length ? data.failed.map((u) => row(u, tr('실패'), true)) : <p className="dim" style={{ fontSize: 13 }}>{tr('없어요.')}</p>}
            </>
          )}
        </div>
      </section>
    </div>
  )
}
