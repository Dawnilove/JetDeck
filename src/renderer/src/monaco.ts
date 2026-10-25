import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import CssWorker from 'monaco-editor/languages/features/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker?worker'
import JsonWorker from 'monaco-editor/languages/features/json/json.worker?worker'
import TsWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker'
import { editorTheme } from './themes'

// Monaco 언어 기능은 웹 워커에서 돌아감 (Vite가 워커 파일을 따로 묶어 줌)
self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

// 편집기 색 = 테마 JSON의 editor 항목 그대로 (팝업 위젯 색만 UI 토큰에서)
function applyEditorTheme(): void {
  const e = editorTheme()
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  try {
    monaco.editor.defineTheme('nanoterm', {
      base: e?.monacoBase ?? (css.colorScheme === 'light' ? 'vs' : 'vs-dark'),
      inherit: true,
      rules: e?.rules ?? [],
      colors: { 'editorWidget.background': v('--panel'), 'editorWidget.border': v('--border'), ...e?.colors }
    })
    monaco.editor.setTheme('nanoterm')
  } catch (err) {
    console.warn('편집기 테마 적용 실패 (테마 JSON 색 값 확인)', err) // 사용자가 넣은 JSON이 잘못돼도 편집기는 동작
  }
}
applyEditorTheme()
window.addEventListener('nanoterm-theme', applyEditorTheme) // themes.ts applyTheme이 보냄

// 확장자로 언어 결정. ROS 파일(.launch/.urdf/.xacro)은 XML
export function languageOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  if (/\.(launch|urdf|xacro|sdf)$/.test(name)) return 'xml'
  if (name === 'dockerfile') return 'dockerfile'
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''
  return monaco.languages.getLanguages().find((l) => l.extensions?.includes(ext))?.id ?? 'plaintext'
}

export { monaco }
