import { useState } from 'react'
import { tr } from '../../../main/i18n.mts'
import Segment from '../components/Segment'
import AiActivity from './AiActivity'
import MonitorHistory from './MonitorHistory'
import ProcessList from './ProcessList'

// 활동 화면: 모니터 기록 / 프로세스 / AI 활동. 열린 탭만 그려서 안 보이는 탭은 Device에서 읽지 않음
export type ActTab = 'history' | 'proc' | 'ai'
type Tab = ActTab
export default function Activity({ connId, online, initialTab = 'history' }: { connId: string; online: boolean; initialTab?: ActTab }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  return (
    <>
      <div style={{ padding: '16px 20px 0', display: 'flex' }}>
        <Segment label={tr('활동 보기')} value={tab} onChange={setTab} options={[{ value: 'history', label: tr('모니터 기록') }, { value: 'proc', label: tr('프로세스') }, { value: 'ai', label: tr('AI 활동') }]} />
      </div>
      {tab === 'history' ? <MonitorHistory connId={connId} /> : tab === 'proc' ? <ProcessList connId={connId} online={online} /> : <AiActivity />}
    </>
  )
}
