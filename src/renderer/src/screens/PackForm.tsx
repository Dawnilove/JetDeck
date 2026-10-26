import { useCallback, useEffect, useState } from 'react'
import { tr } from '../../../main/i18n.mts'
import { checkValue, type Field } from '../../../main/packfields.mts'
import type { PackAction } from '../../../main/packschema.mts'
import { errText } from '../util'
import { lt } from './PackUi'

// 입력 폼 (5.1.0): 팩 항목의 fields를 칸으로 그림. 값 검사는 편의일 뿐이고 main이 실행할 때마다 다시 검사함
const SECRET_NAME = /password|token|secret|key/i // 비밀처럼 보이는 이름의 칸은 마지막 값을 기억하지 않음

const initialOf = (f: Field): string => {
  if (f.default !== undefined) return f.default
  if (f.type === 'flag') return 'false'
  if (f.type === 'int') return String(f.min)
  if (f.type === 'select' && f.choices) return f.choices[0].value
  return ''
}

const memKey = (packId: string, pluginId: string, a: PackAction) => `pk-last:${packId}/${pluginId}/${a.id}`

// 항목의 칸 값: 처음엔 기본값(+ 이 앱이 기억한 마지막 값). 고르면 기억함
export function useFormValues(packId: string, pluginId: string, a: PackAction): [Record<string, string>, (name: string, v: string) => void] {
  const fields = a.fields ?? []
  const [values, setValues] = useState<Record<string, string>>(() => {
    let mem: Record<string, string> = {}
    try {
      mem = JSON.parse(localStorage.getItem(memKey(packId, pluginId, a)) ?? '{}') as Record<string, string>
    } catch {
      /* 저장소를 못 읽어도 기본값으로 동작 */
    }
    return Object.fromEntries(fields.map((f) => [f.name, typeof mem[f.name] === 'string' && !SECRET_NAME.test(f.name) && (f.type !== 'select' || f.from || f.choices?.some((c) => c.value === mem[f.name])) ? mem[f.name] : initialOf(f)]))
  })
  const set = useCallback(
    (name: string, v: string) =>
      setValues((m) => {
        const next = { ...m, [name]: v }
        try {
          localStorage.setItem(memKey(packId, pluginId, a), JSON.stringify(Object.fromEntries(Object.entries(next).filter(([k]) => !SECRET_NAME.test(k)))))
        } catch {
          /* 기억 못 해도 동작에는 문제 없음 */
        }
        return next
      }),
    [packId, pluginId, a.id]
  )
  return [values, set]
}

// 칸마다 틀린 이유 (앱 글자). 비어 있어도 되는 칸은 비면 통과 (main의 resolveFields와 같은 규칙)
export function formErrors(fields: Field[] | undefined, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of fields ?? []) {
    const v = values[f.name] ?? initialOf(f)
    if (v === '' && f.required === false && f.type !== 'flag' && f.type !== 'int') continue
    const bad = checkValue(f, v)
    if (bad) out[f.name] = bad.replace(`${f.name}: `, '')
  }
  return out
}

type Props = { connId: string; online: boolean; packId: string; pluginId: string; action: PackAction; values: Record<string, string>; onChange: (name: string, v: string) => void; disabled?: boolean }

export function FieldInputs({ connId, online, packId, pluginId, action, values, onChange, disabled }: Props) {
  const errors = formErrors(action.fields, values)
  return (
    <>
      {action.fields?.map((f) => (
        <div key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap' }} title={f.desc ? lt(f.desc) : undefined}>
            {f.type !== 'flag' && lt(f.label)}
            {f.type === 'select' && f.from ? (
              <FromSelect connId={connId} online={online} packId={packId} pluginId={pluginId} action={action} field={f} value={values[f.name]} onChange={(v) => onChange(f.name, v)} disabled={disabled} />
            ) : f.type === 'select' ? (
              <select className="input" style={{ height: 36 }} value={values[f.name]} disabled={disabled} onChange={(e) => onChange(f.name, e.target.value)}>
                {f.choices?.map((ch) => (
                  <option key={ch.value} value={ch.value}>{lt(ch.label)}</option>
                ))}
              </select>
            ) : f.type === 'flag' ? (
              <>
                <input type="checkbox" checked={values[f.name] === 'true'} disabled={disabled} onChange={(e) => onChange(f.name, e.target.checked ? 'true' : 'false')} />
                {lt(f.label)}
              </>
            ) : (
              <input
                className="input"
                style={{ height: 36, width: f.type === 'int' ? 110 : 200 }}
                type={f.type === 'int' ? 'number' : 'text'}
                min={f.type === 'int' ? f.min : undefined}
                max={f.type === 'int' ? f.max : undefined}
                value={values[f.name]}
                disabled={disabled}
                spellCheck={false}
                aria-invalid={!!errors[f.name]}
                onChange={(e) => onChange(f.name, e.target.value)}
              />
            )}
          </label>
          {errors[f.name] && <span className="msg-err" role="status" style={{ fontSize: 12 }}>{errors[f.name]}</span>}
        </div>
      ))}
    </>
  )
}

// from 선택지: 화면을 열 때 한 번 불러오고(읽기 명령) 새로고침 버튼으로 다시 불러옴
function FromSelect({ connId, online, packId, pluginId, action, field, value, onChange, disabled }: { connId: string; online: boolean; packId: string; pluginId: string; action: PackAction; field: Field; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [state, setState] = useState<{ items?: string[]; loading: boolean; error?: string }>({ loading: false })
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: undefined }))
    try {
      const items = await window.api.packFrom(connId, packId, pluginId, action.id, field.name)
      setState({ items, loading: false })
    } catch (e) {
      setState({ loading: false, error: errText(e) })
    }
  }, [connId, packId, pluginId, action.id, field.name])
  useEffect(() => {
    if (online) load()
  }, [online, load])
  const items = state.items ?? []
  useEffect(() => {
    if (!value && items.length) onChange(items[0]) // 처음 목록이 오면 첫 값을 고른 것으로 침
  }, [items.length])
  const list = value && !items.includes(value) ? [value, ...items] : items // 기억해 둔 값이 목록에 없어도 칸이 비어 보이지 않게
  return (
    <>
      <select className="input" style={{ height: 36, minWidth: 160 }} value={value} disabled={disabled || state.loading} onChange={(e) => onChange(e.target.value)}>
        {!list.length && <option value="">{state.loading ? tr('목록 불러오는 중…') : tr('(목록이 비었어요)')}</option>}
        {list.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
      <button type="button" className="btn btn-ghost btn-36" aria-label={tr('목록 새로고침')} title={tr('목록 새로고침')} disabled={disabled || state.loading} onClick={load}>⟳</button>
      {state.error && <span className="msg-err" role="status" style={{ fontSize: 12 }} title={state.error}>{tr('목록을 불러오지 못했어요')}</span>}
    </>
  )
}
