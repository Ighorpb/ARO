# Cria o venv, instala deps e baixa os modelos do Kokoro.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$python = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
if (-not (Test-Path $python)) { $python = "python" }

if (-not (Test-Path ".venv")) {
  Write-Host "[voice] criando venv com $python"
  & $python -m venv .venv
}

Write-Host "[voice] instalando dependências (CUDA libs são pesadas, ~1GB)"
& .venv\Scripts\python.exe -m pip install --upgrade pip --quiet
& .venv\Scripts\python.exe -m pip install -r requirements.txt

$base = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1"
$files = @("kokoro-v1.0.onnx", "voices-v1.0.bin")
foreach ($f in $files) {
  $dest = "models\$f"
  if (-not (Test-Path $dest)) {
    Write-Host "[voice] baixando $f"
    Invoke-WebRequest -Uri "$base/$f" -OutFile $dest
  }
}

Write-Host ""
Write-Host "[voice] pronto. Roda com: pnpm --filter @aro/voice dev"
Write-Host "[voice] o modelo do Whisper baixa sozinho na primeira vez (~1.6GB)."
