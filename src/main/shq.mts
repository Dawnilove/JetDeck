// 셸 인자로 안전하게: 작은따옴표로 감싸고, 안의 ' 는 '\'' 로 바꿈 (main·화면이 같이 씀)
export const shq = (s: string) => "'" + s.split("'").join("'\\''") + "'"
