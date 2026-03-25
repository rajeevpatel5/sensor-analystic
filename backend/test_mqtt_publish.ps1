$ErrorActionPreference = 'Stop'

$broker = 'broker.emqx.io'
$port = 1883
$topic = 'node-01-for-test'
$intervalSeconds = 2
$durationSeconds = 120
$iterations = [int]($durationSeconds / $intervalSeconds)
$publisher = 'C:\Program Files (x86)\Mosquitto\mosquitto_pub.exe'

if (-not (Test-Path $publisher)) {
  throw "mosquitto_pub.exe not found at $publisher"
}

$tempPayloadFile = Join-Path $env:TEMP 'mqtt-test-payload.json'

Write-Host "Starting MQTT test publisher"
Write-Host "Broker: $broker`:$port"
Write-Host "Topic: $topic"
Write-Host "Duration: $durationSeconds seconds"
Write-Host "Interval: $intervalSeconds seconds"

for ($i = 1; $i -le $iterations; $i++) {
  $temperature = [math]::Round((24 + (Get-Random -Minimum -20 -Maximum 21) / 10), 1)
  $humidity = [math]::Round((55 + (Get-Random -Minimum -150 -Maximum 151) / 10), 1)
  $air = Get-Random -Minimum 450 -Maximum 950
  $fire = if ((Get-Random -Minimum 1 -Maximum 101) -le 8) { 1 } else { 0 }
  $timestamp = (Get-Date).ToString('o')
  $payload = @{
    temperature = $temperature
    humidity = $humidity
    air_quality = $air
    fire_alarm = $fire
    timestamp = $timestamp
    location = 'EMQX'
  } | ConvertTo-Json -Compress

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($tempPayloadFile, $payload, $utf8NoBom)
  & $publisher -h $broker -p $port -t $topic -f $tempPayloadFile

  Write-Host ("[{0}/{1}] {2}" -f $i, $iterations, $payload)

  if ($i -lt $iterations) {
    Start-Sleep -Seconds $intervalSeconds
  }
}

if (Test-Path $tempPayloadFile) {
  Remove-Item $tempPayloadFile -Force
}

Write-Host 'MQTT test completed'
