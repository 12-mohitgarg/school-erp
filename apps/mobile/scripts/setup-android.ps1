<#
.SYNOPSIS
  Installs everything `npx expo run:android` needs, without administrator rights.

.DESCRIPTION
  `expo run:android` compiles the app locally, so it needs a JDK and the Android
  SDK. This installs both into the user profile — no UAC prompt, no Android
  Studio, and nothing written outside %LOCALAPPDATA%.

  Versions are not arbitrary:
    * JDK 17   — Gradle 9.3.1 and AGP require 17 or newer; 17 is the version
                 React Native 0.86 is tested against.
    * SDK 36   — `compileSdkVersion 36`, from Expo SDK 57's Gradle defaults.

  Safe to re-run: every step is skipped if it is already in place.
#>

$ErrorActionPreference = 'Stop'

$Root       = Join-Path $env:LOCALAPPDATA 'Android'
$SdkRoot    = Join-Path $Root 'Sdk'
$JdkRoot    = Join-Path $env:LOCALAPPDATA 'Programs\Eclipse Adoptium'
$Downloads  = Join-Path $env:TEMP 'edusphere-android-setup'
$CmdlineUrl = 'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip'
$JdkUrl     = 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse'

New-Item -ItemType Directory -Force -Path $Downloads | Out-Null

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# ---------------------------------------------------------------------------
# 1. JDK 17
# ---------------------------------------------------------------------------

Write-Step 'JDK 17'

$JavaHome = Get-ChildItem $JdkRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like 'jdk-17*' } |
            Select-Object -First 1 -ExpandProperty FullName

if (-not $JavaHome) {
  $jdkZip = Join-Path $Downloads 'jdk17.zip'
  if (-not (Test-Path $jdkZip)) {
    Write-Host 'Downloading Temurin JDK 17 (~180 MB)...'
    Invoke-WebRequest -Uri $JdkUrl -OutFile $jdkZip -UseBasicParsing
  }
  New-Item -ItemType Directory -Force -Path $JdkRoot | Out-Null
  Write-Host 'Extracting...'
  Expand-Archive -Path $jdkZip -DestinationPath $JdkRoot -Force
  $JavaHome = Get-ChildItem $JdkRoot -Directory |
              Where-Object { $_.Name -like 'jdk-17*' } |
              Select-Object -First 1 -ExpandProperty FullName
}

if (-not $JavaHome) { throw 'JDK 17 extraction failed.' }
Write-Host "JAVA_HOME = $JavaHome" -ForegroundColor Green

$env:JAVA_HOME = $JavaHome
$env:PATH      = "$JavaHome\bin;$env:PATH"

# ---------------------------------------------------------------------------
# 2. Android command-line tools
# ---------------------------------------------------------------------------

Write-Step 'Android command-line tools'

$CmdlineLatest = Join-Path $SdkRoot 'cmdline-tools\latest'

if (-not (Test-Path (Join-Path $CmdlineLatest 'bin\sdkmanager.bat'))) {
  $cliZip = Join-Path $Downloads 'cmdline-tools.zip'
  if (-not (Test-Path $cliZip)) {
    Write-Host 'Downloading Android command-line tools (~150 MB)...'
    Invoke-WebRequest -Uri $CmdlineUrl -OutFile $cliZip -UseBasicParsing
  }

  $staging = Join-Path $Downloads 'cmdline-staging'
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -Path $cliZip -DestinationPath $staging -Force

  # The zip contains a top-level `cmdline-tools` folder, but sdkmanager insists
  # on living at <sdk>/cmdline-tools/latest — it resolves its own libraries
  # relative to that path and fails with a bare ClassNotFoundException if the
  # layout is wrong.
  New-Item -ItemType Directory -Force -Path (Split-Path $CmdlineLatest) | Out-Null
  Move-Item (Join-Path $staging 'cmdline-tools') $CmdlineLatest -Force
}

Write-Host "SDK root = $SdkRoot" -ForegroundColor Green

$env:ANDROID_HOME     = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:PATH             = "$CmdlineLatest\bin;$SdkRoot\platform-tools;$env:PATH"

# ---------------------------------------------------------------------------
# 3. SDK packages
# ---------------------------------------------------------------------------

Write-Step 'SDK packages (licences, platform-tools, android-36, build-tools)'

$sdkmanager = Join-Path $CmdlineLatest 'bin\sdkmanager.bat'

# `yes` to every licence prompt. Non-interactive by necessity: the licence
# prompt blocks forever otherwise.
$acceptAll = ('y' * 40) -split '' | Where-Object { $_ }
$acceptAll -join "`n" | & $sdkmanager --licenses --sdk_root="$SdkRoot" 2>&1 | Select-Object -Last 3

& $sdkmanager --sdk_root="$SdkRoot" `
  'platform-tools' `
  'platforms;android-36' `
  'build-tools;36.0.0' 2>&1 | Select-Object -Last 5

# A native command's failure does not trip $ErrorActionPreference, so it has to
# be checked by hand — otherwise this script reports success having installed
# nothing, and the failure only surfaces later as a confusing Gradle error.
if ($LASTEXITCODE -ne 0) { throw "sdkmanager failed (exit $LASTEXITCODE)." }

foreach ($required in @(
  (Join-Path $SdkRoot 'platform-toolsdb.exe'),
  (Join-Path $SdkRoot 'platformsndroid-36'),
  (Join-Path $SdkRoot 'build-tools.0.0')
)) {
  if (-not (Test-Path $required)) { throw "Expected SDK component missing: $required" }
}

# ---------------------------------------------------------------------------
# 4. Persist for future terminals
# ---------------------------------------------------------------------------

Write-Step 'Persisting environment variables (user scope)'

[Environment]::SetEnvironmentVariable('JAVA_HOME', $JavaHome, 'User')
[Environment]::SetEnvironmentVariable('ANDROID_HOME', $SdkRoot, 'User')
[Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT', $SdkRoot, 'User')

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$wanted   = @("$JavaHome\bin", "$SdkRoot\platform-tools", "$CmdlineLatest\bin")

foreach ($entry in $wanted) {
  if ($userPath -notlike "*$entry*") { $userPath = "$entry;$userPath" }
}
[Environment]::SetEnvironmentVariable('Path', $userPath, 'User')

Write-Step 'Done'
Write-Host 'Verifying:' -ForegroundColor Green
& "$JavaHome\bin\java.exe" -version 2>&1 | Select-Object -First 1
& "$SdkRoot\platform-tools\adb.exe" version 2>&1 | Select-Object -First 1

Write-Host "`nOpen a NEW terminal, then:  npx expo run:android" -ForegroundColor Yellow
