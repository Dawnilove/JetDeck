# JetDeck MCP 연결 프로그램 (Windows PowerShell 5.1용)
# JetDeck이 켜질 때마다 이 파일을 최신으로 ~/.jetdeck/mcp-bridge.ps1에 덮어씀 (직접 고치지 마세요)
# Claude·Cursor 같은 AI가 이 스크립트를 실행하고, 스크립트는 켜 둔 JetDeck(127.0.0.1)에 요청을 넘김.
# JetDeck.exe가 아니라서 JetDeck을 업데이트(설치 프로그램이 JetDeck.exe를 종료)해도 AI와의 연결이 끊기지 않고,
# JetDeck이 다시 켜질 때까지 도구 호출을 기다렸다가 이어서 처리함
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Web.Extensions
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.MaxJsonLength = [int]::MaxValue
$ser.RecursionLimit = 200
$utf8 = New-Object System.Text.UTF8Encoding($false)
$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$writer = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$writer.AutoFlush = $true
$writer.NewLine = "`n"
$dir = if ($env:JETDECK_DIR) { $env:JETDECK_DIR } else { Join-Path $env:USERPROFILE '.jetdeck' }

$TOOLS = $ser.DeserializeObject(@'
__TOOLS_JSON__
'@)
$INSTRUCTIONS = @'
__INSTRUCTIONS__
'@
$script:clientName = 'MCP'
$script:announced = ''

function Send($obj) { $writer.WriteLine($ser.Serialize($obj)) }

# JetDeck이 적어 둔 주소·토큰 (그 JetDeck이 살아 있을 때만)
function Read-Info {
  try {
    $i = $ser.DeserializeObject([IO.File]::ReadAllText((Join-Path $dir 'mcp.json')))
    if (Get-Process -Id ([int]$i['pid']) -ErrorAction SilentlyContinue) { return $i }
  } catch {}
  return $null
}

function Post($info, $name, $toolArgs) {
  $body = $ser.Serialize(@{ name = $name; arguments = $toolArgs; pid = $PID }) # pid: 어느 AI 도구가 불렀는지 기록하려고
  $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri ('http://127.0.0.1:{0}/call' -f $info['port']) `
    -Headers @{ authorization = ('Bearer ' + $info['token']) } -ContentType 'application/json' -Body ($utf8.GetBytes($body)) -TimeoutSec 900
  return $ser.DeserializeObject($utf8.GetString($r.RawContentStream.ToArray()))
}

# 연결 불: 어떤 AI가 붙어 있는지 JetDeck에 알림 (JetDeck이 다시 켜져 토큰이 바뀌면 다시 알림)
function Announce($info) {
  if ($script:announced -eq $info['token']) { return }
  $script:announced = $info['token']
  try { $null = Post $info '__hello' @{ client = $script:clientName; pid = $PID } } catch { $script:announced = '' }
}

function Start-App {
  $exe = $null
  try { $exe = $ser.DeserializeObject([IO.File]::ReadAllText((Join-Path $dir 'app.json')))['exe'] } catch {}
  if (-not $exe -or -not (Test-Path $exe)) { $exe = Join-Path $env:LOCALAPPDATA 'Programs\JetDeck\JetDeck.exe' }
  # 탐색기에 시켜 따로 띄움 (Store판 Claude 안에서 직접 띄우면 %APPDATA%가 가짜 복사본으로 보임)
  if (Test-Path $exe) { Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $exe + '"') }
}

# 업데이트로 JetDeck이 잠깐 꺼진 거라면 곧 다시 켜지므로 5초는 기다린 뒤에 직접 켬
function Ensure-App {
  $i = Read-Info
  if ($i) { return $i }
  for ($k = 0; $k -lt 10; $k++) { Start-Sleep -Milliseconds 500; $i = Read-Info; if ($i) { return $i } }
  Start-App
  for ($k = 0; $k -lt 170; $k++) { Start-Sleep -Milliseconds 500; $i = Read-Info; if ($i) { return $i } }
  throw 'JetDeck을 켜지 못했어요. JetDeck을 직접 실행한 뒤 다시 시도해 주세요'
}

function Call-Tool($name, $toolArgs) {
  for ($t = 0; $t -lt 2; $t++) {
    try {
      $info = Ensure-App
      Announce $info
      return Post $info $name $toolArgs
    } catch {
      # JetDeck이 응답은 했는데 거부한 경우(HTTP 오류)나 두 번째 실패는 그대로 알려 줌. 연결 자체가 안 된 경우만 한 번 더
      if ($t -eq 1 -or $_.Exception.Response) { return @{ text = ('JetDeck 오류: ' + $_.Exception.Message); isError = $true } }
    }
  }
}

function Handle($m) {
  $method = $m['method']
  $hasId = $m.ContainsKey('id')
  $id = $m['id']
  switch ($method) {
    'initialize' {
      $p = $m['params']
      if ($p -and $p['clientInfo'] -and $p['clientInfo']['name']) { $script:clientName = [string]$p['clientInfo']['name'] }
      $pv = if ($p -and $p['protocolVersion']) { $p['protocolVersion'] } else { '2025-06-18' }
      $i = Read-Info
      if ($i) { Announce $i } # 꺼져 있으면 일부러 켜지 않음 (첫 도구 호출 때 켜고 알림)
      Send @{ jsonrpc = '2.0'; id = $id; result = @{ protocolVersion = $pv; capabilities = @{ tools = @{ listChanged = $false } }; serverInfo = @{ name = 'jetdeck'; version = 'bridge' }; instructions = $INSTRUCTIONS } }
    }
    'ping' { if ($hasId) { Send @{ jsonrpc = '2.0'; id = $id; result = @{} } } }
    'tools/list' { Send @{ jsonrpc = '2.0'; id = $id; result = @{ tools = $TOOLS } } }
    'tools/call' {
      $p = $m['params']
      $toolArgs = $p['arguments']
      if ($null -eq $toolArgs) { $toolArgs = @{} }
      $r = Call-Tool ([string]$p['name']) $toolArgs
      Send @{ jsonrpc = '2.0'; id = $id; result = @{ content = @(@{ type = 'text'; text = [string]$r['text'] }); isError = [bool]$r['isError'] } }
    }
    default {
      # 알림(id 없음)은 무시, 모르는 요청은 오류로 답함
      if ($hasId) { Send @{ jsonrpc = '2.0'; id = $id; error = @{ code = -32601; message = ('지원하지 않는 요청: ' + $method) } } }
    }
  }
}

# 표준 입력에서 한 줄씩 요청을 읽음. 1초마다 깨어나 JetDeck이 새로 켜졌는지 확인해 연결 불을 다시 켬
$task = $reader.ReadLineAsync()
while ($true) {
  if ($task.Wait(1000)) {
    $line = $task.Result
    if ($null -eq $line) { break } # AI가 연결을 끊으면 끝
    if ($line.Trim()) {
      try { Handle ($ser.DeserializeObject($line)) } catch { Send @{ jsonrpc = '2.0'; id = $null; error = @{ code = -32603; message = $_.Exception.Message } } }
    }
    $task = $reader.ReadLineAsync()
  } else {
    $i = Read-Info
    if ($i) { Announce $i }
  }
}
