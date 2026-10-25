// 실행: npm test  (Node 내장 테스트 러너, 추가 패키지 없음)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDevice, parseDf, parseModes, parseNvpQuery, parseProc, parseTegrastats } from './tegrastats.mts'

test('Jetson Nano 샘플', () => {
  const s = parseTegrastats(
    'RAM 2400/3964MB (lfb 120x4MB) SWAP 0/1982MB (cached 0MB) CPU [38%@1428,22%@1428,61%@1428,15%@1428] EMC_FREQ 0% GR3D_FREQ 27% PLL@44C CPU@47C PMIC@50C GPU@45C AO@52C thermal@46C POM_5V_IN 2890/2890 POM_5V_GPU 120/120 POM_5V_CPU 840/840'
  )
  assert.deepEqual(s.ram, { used: 2400, total: 3964 })
  assert.deepEqual(s.cpu, [
    { pct: 38, mhz: 1428 },
    { pct: 22, mhz: 1428 },
    { pct: 61, mhz: 1428 },
    { pct: 15, mhz: 1428 }
  ])
  assert.equal(s.gpu, 27)
  assert.deepEqual(s.temps, { cpu: 47, gpu: 45, board: 46, boardName: 'thermal' })
  assert.equal(s.powerMw, 2890)
})

test('Orin Nano Super 실제 출력 (6코어, 소문자 온도, mW 단위)', () => {
  const s = parseTegrastats(
    '10-22-2026 18:53:33 RAM 3083/7485MB (lfb 15x4MB) CPU [1%@883,1%@883,0%@883,0%@883,0%@729,0%@729] GR3D_FREQ 0% cpu@46.187C/46.187C soc2@45.968C/45.968C soc0@46.531C/46.531C gpu@46.656C/46.656C tj@46.812C/46.812C soc1@46.812C/46.812C VDD_IN 4694mW/4694mW/4694mW VDD_CPU_GPU_CV 481mW/481mW/481mW VDD_SOC 1364mW/1364mW/1364mW'
  )
  assert.deepEqual(s.ram, { used: 3083, total: 7485 })
  assert.equal(s.cpu.length, 6)
  assert.deepEqual(s.cpu[4], { pct: 0, mhz: 729 })
  assert.equal(s.gpu, 0)
  assert.deepEqual(s.temps, { cpu: 46.187, gpu: 46.656, board: 46.812, boardName: 'tj' })
  assert.equal(s.powerMw, 4694)
})

test('꺼진 코어(off)와 빈 줄', () => {
  assert.deepEqual(parseTegrastats('CPU [12%@1200,off,off,5%@1200]').cpu, [
    { pct: 12, mhz: 1200 },
    { pct: null, mhz: null },
    { pct: null, mhz: null },
    { pct: 5, mhz: 1200 }
  ])
  const empty = parseTegrastats('')
  assert.equal(empty.ram, null)
  assert.deepEqual(empty.cpu, [])
  assert.equal(empty.gpu, null)
})

test('전원 모드 목록 (/etc/nvpmodel.conf, 주석 줄 무시)', () => {
  const conf = '# < POWER_MODEL ID=id_num NAME=mode_name >\n< POWER_MODEL ID=0 NAME=15W >\nfoo\n< POWER_MODEL ID=1 NAME=25W >\n< POWER_MODEL ID=2 NAME=MAXN_SUPER >\n'
  assert.deepEqual(parseModes(conf), [
    { id: 0, name: '15W' },
    { id: 1, name: '25W' },
    { id: 2, name: 'MAXN_SUPER' }
  ])
})

test('nvpmodel -q, df -k', () => {
  assert.deepEqual(parseNvpQuery('NV Power Mode: 25W\n1\n'), { id: 1, name: '25W' })
  assert.equal(parseNvpQuery('nvpmodel: command not found'), null)
  assert.deepEqual(parseDf('Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/nvme0n1p1 243681400 12000000 219000000 6% /\n'), {
    used: 12000000,
    total: 243681400
  })
})

test('꺼진 센서 온도(-256C)는 없는 값으로', () => {
  const s = parseTegrastats('RAM 2400/7620MB CPU [5%@729] GR3D_FREQ 0% cpu@45.5C gpu@-256C soc2@44C tj@46C VDD_IN 4500mW/4500mW')
  assert.equal(s.temps.gpu, null)
  assert.equal(s.temps.cpu, 45.5)
})

test('일반 리눅스(라즈베리 파이 5) /proc·/sys 값', () => {
  const t0 = parseProc('cpu0 100 0 50 800 50 0 0 0 0 0\ncpu1 100 0 50 800 50 0 0 0 0 0\n', {})
  assert.equal(t0.stats, null) // 첫 값은 비교할 이전 값이 없음
  const out = `cpu0 150 0 100 900 50 0 0 0 0 0
cpu1 100 0 50 1000 50 0 0 0 0 0
MemTotal:        8257680 kB
MemAvailable:    7695936 kB
/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq:1500000
/sys/devices/system/cpu/cpu1/cpufreq/scaling_cur_freq:2400000
/sys/class/thermal/thermal_zone0/temp:49050
/sys/class/thermal/thermal_zone0/type:cpu-thermal
`
  const s = parseProc(out, t0.times).stats!
  assert.deepEqual(s.cpu, [{ pct: 50, mhz: 1500 }, { pct: 0, mhz: 2400 }]) // cpu0: 총 +200 중 놀기 +100 → 50%, cpu1: 모두 놀았음
  assert.deepEqual(s.ram, { used: 549, total: 8064 })
  assert.equal(s.temps.cpu, 49.05)
  assert.equal(s.gpu, null)
  assert.equal(s.powerMw, null)
})

test('Jetson 온도 구역: cpu·gpu·나머지를 이름으로 구분', () => {
  const t0 = parseProc('cpu0 10 0 0 90 0 0 0 0 0 0\n', {})
  const out = `cpu0 20 0 0 180 0 0 0 0 0 0
/sys/class/thermal/thermal_zone0/temp:46000
/sys/class/thermal/thermal_zone0/type:cpu-thermal
/sys/class/thermal/thermal_zone1/temp:47000
/sys/class/thermal/thermal_zone1/type:gpu-thermal
/sys/class/thermal/thermal_zone5/temp:45500
/sys/class/thermal/thermal_zone5/type:soc0-thermal
`
  const s = parseProc(out, t0.times).stats!
  assert.deepEqual([s.temps.cpu, s.temps.gpu, s.temps.board, s.temps.boardName], [46, 47, 45.5, 'soc0-thermal'])
})

test('기기 이름·JetPack·CUDA', () => {
  const d = parseDevice(
    'JP=7.2.1-b49\nL4T=# R39 (release), REVISION: 2.1, GCID: 1\nNVCC=release 13.2\nCUDAJSON={"cuda":{"name":"CUDASDK","version":"13.2.2"},"cuda_cccl":{}}\nMODEL=NVIDIA Jetson Orin Nano Engineering Reference Developer Kit Super\n'
  )
  assert.deepEqual(d, { model: 'NVIDIA Jetson Orin Nano Engineering Reference Developer Kit Super', jetpack: 'JetPack 7.2.1', cuda: 'CUDA 13.2.2' })
  // JetPack 패키지가 없으면 L4T로, 라즈베리 파이는 이름만
  assert.equal(parseDevice('JP=\nL4T=# R36 (release), REVISION: 4.3\nNVCC=\nCUDAJSON=\nMODEL=\n').jetpack, 'L4T 36.4.3')
  assert.deepEqual(parseDevice('JP=\nL4T=\nNVCC=\nCUDAJSON=\nMODEL=Raspberry Pi 5 Model B Rev 1.1\n'), { model: 'Raspberry Pi 5 Model B Rev 1.1', jetpack: undefined, cuda: undefined })
})
