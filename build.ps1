# NoteCook 배포 빌드 스크립트
# 사용: 우클릭 > PowerShell 실행  또는  powershell -ExecutionPolicy Bypass -File build.ps1

Write-Host "[NoteCook] 의존성 확인..." -ForegroundColor Cyan
python -m pip install -r requirements.txt
python -m pip install pyinstaller

# (선택) Ollama 런타임 번들: 설치 폴더를 vendor/ollama 로 복사
$ollamaSrc = Join-Path $env:LOCALAPPDATA "Programs\Ollama"
if ((Test-Path $ollamaSrc) -and -not (Test-Path "vendor\ollama")) {
    Write-Host "[NoteCook] Ollama 런타임을 vendor/ollama 로 복사 중..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path "vendor\ollama" | Out-Null
    Copy-Item -Path (Join-Path $ollamaSrc "*") -Destination "vendor\ollama" -Recurse -Force
} elseif (-not (Test-Path $ollamaSrc)) {
    Write-Host "[NoteCook] Ollama 미설치 → 런타임 번들 없이 빌드 (앱이 설치 안내 표시)" -ForegroundColor Yellow
}

Write-Host "[NoteCook] PyInstaller 빌드..." -ForegroundColor Cyan
python -m PyInstaller NoteCook.spec --noconfirm
Write-Host "[NoteCook] 앱 빌드 완료 → dist\NoteCook\NoteCook.exe" -ForegroundColor Green

# 캐시 무효화: 번들된 index.html 의 정적 자산 참조에 빌드 버전 쿼리(?v=...) 주입.
# in-place 업데이트(언인스톨 없이 재설치) 시 WebView2 가 옛 app.js/styles.css 를
# 캐시해 "이전 버전처럼" 뜨는 문제를 방지. 소스 web/index.html 은 건드리지 않고
# 매 빌드마다 새로 복사된 번들 파일에만 새 버전을 새긴다(멱등).
$idx = "dist\NoteCook\_internal\web\index.html"
if (Test-Path $idx) {
    $ver = Get-Date -Format "yyyyMMddHHmmss"
    $html = [System.IO.File]::ReadAllText($idx)
    $html = $html -replace 'href="styles\.css(\?v=[0-9]+)?"', "href=`"styles.css?v=$ver`""
    $html = $html -replace 'src="app\.js(\?v=[0-9]+)?"', "src=`"app.js?v=$ver`""
    [System.IO.File]::WriteAllText($idx, $html, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "[NoteCook] 자산 캐시버전 주입: v=$ver" -ForegroundColor Cyan
} else {
    Write-Host "[NoteCook] 경고: $idx 를 찾지 못해 캐시버전 주입을 건너뜀" -ForegroundColor Yellow
}

# 설치 파일 생성 (Inno Setup 이 있으면)
$iscc = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($iscc) {
    Write-Host "[NoteCook] 설치 파일 생성 (Inno Setup)..." -ForegroundColor Cyan
    & $iscc installer.iss
    Write-Host "[NoteCook] 설치 파일 완료 → Output\NoteCook-Setup.exe" -ForegroundColor Green
} else {
    Write-Host "[NoteCook] Inno Setup 미설치 → 설치 파일 생략 (winget install JRSoftware.InnoSetup)" -ForegroundColor Yellow
}
