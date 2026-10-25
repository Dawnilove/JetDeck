// 앱 아이콘(resources/icon.svg)의 마크만 — 바탕은 쓰는 곳에서 강조색으로 깔아 테마를 따름
export default function Logo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="18 9 129 129" fill="none" stroke="currentColor" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="34,52 60,78 34,104" />
      <path d="M72 104 H92 C114 104 126 84 126 62" />
      <circle cx="126" cy="48" r="14" fill="currentColor" stroke="none" />
    </svg>
  )
}
