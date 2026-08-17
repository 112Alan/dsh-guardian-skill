# Vision proxy (Gemini web2api, port 8083) restart script.
# Called by the watchdog when watchVisionProxy=true and port 8083 is down.
# Edit this file if the proxy launch command changes.
$base = 'C:\Users\16021\deepseek多模态\vision-proxy'
$env:TOKENS_FILE = "$base\gemini-tokens.json"
Start-Process "$base\bin\gemini-web2api-fixed.exe" -ArgumentList `
  '--port','8083',`
  '--admin-token','dsh-vision-2026',`
  '--api-key','sk-gemini-test-123',`
  '--db',"$base\g2data\gemini.db",`
  '--proxy','http://127.0.0.1:7890',`
  '--cookie-file',"$base\google-cookies.txt" `
  -WindowStyle Hidden