<#
.SYNOPSIS
  Creates an Android emulator, for when no physical phone is available.

.DESCRIPTION
  Run `setup-android.ps1` first. This adds ~1.5 GB of system image on top.

  A physical phone is the better option for this particular app — the emulator
  fakes GPS (so the live-tracking screens show a stationary bus unless you feed
  it coordinates by hand) and has no Play Services, so push notifications never
  arrive. Use it to check layout and navigation, not the safety features.

  Requires hardware virtualisation. If the emulator refuses to start, that is
  almost always why.

  This script resolves JAVA_HOME itself rather than trusting the ambient
  environment: `setup-android.ps1` persists the variable to User scope, but any
  terminal opened *before* that ran still has the old environment, and
  sdkmanager fails with a bare "JAVA_HOME is not set" that looks like the setup
  never happened.
#>

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# ---------------------------------------------------------------------------
# Resolve the toolchain without depending on the current shell
# ---------------------------------------------------------------------------

$SdkRoot = $env:ANDROID_HOME
if (-not $SdkRoot) { $SdkRoot = [Environment]::GetEnvironmentVariable('ANDROID_HOME', 'User') }
if (-not $SdkRoot) { $SdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }

$JavaHome = $env:JAVA_HOME
if (-not $JavaHome) { $JavaHome = [Environment]::GetEnvironmentVariable('JAVA_HOME', 'User') }
if (-not $JavaHome -or -not (Test-Path $JavaHome)) {
  $JavaHome = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs\Eclipse Adoptium') -Directory -ErrorAction SilentlyContinue |
              Where-Object { $_.Name -like 'jdk-17*' } |
              Select-Object -First 1 -ExpandProperty FullName
}

if (-not $JavaHome -or -not (Test-Path (Join-Path $JavaHome 'bin\java.exe'))) {
  throw "JDK 17 not found. Run scripts/setup-android.ps1 first."
}

$Cmdline = Join-Path $SdkRoot 'cmdline-tools\latest\bin'
if (-not (Test-Path (Join-Path $Cmdline 'sdkmanager.bat'))) {
  throw "Android SDK not found at $SdkRoot. Run scripts/setup-android.ps1 first."
}

$env:JAVA_HOME        = $JavaHome
$env:ANDROID_HOME     = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:PATH             = "$JavaHome\bin;$Cmdline;$SdkRoot\platform-tools;$env:PATH"

Write-Host "JAVA_HOME    = $JavaHome"
Write-Host "ANDROID_HOME = $SdkRoot"

$Image   = 'system-images;android-36;google_apis;x86_64'
$AvdName = 'edusphere'

# ---------------------------------------------------------------------------
# Emulator + system image
# ---------------------------------------------------------------------------

Write-Step 'Installing emulator + system image (~1.5 GB)'

# `y` to the system-image licence, which is separate from the SDK licences.
$yes = (1..40 | ForEach-Object { 'y' }) -join "`n"
$yes | & (Join-Path $Cmdline 'sdkmanager.bat') --sdk_root="$SdkRoot" 'emulator' $Image 2>&1 |
  Select-Object -Last 4

# A native command's failure does not trip $ErrorActionPreference, so it has to
# be checked by hand — otherwise this script "succeeds" having done nothing.
if ($LASTEXITCODE -ne 0) { throw "sdkmanager failed (exit $LASTEXITCODE)." }

$imagePath = Join-Path $SdkRoot 'system-images\android-36\google_apis\x86_64'
if (-not (Test-Path $imagePath)) { throw "System image missing at $imagePath." }

# ---------------------------------------------------------------------------
# AVD
# ---------------------------------------------------------------------------

Write-Step "Creating AVD '$AvdName'"

'no' | & (Join-Path $Cmdline 'avdmanager.bat') create avd `
  --name $AvdName --package $Image --device 'pixel_7' --force 2>&1 | Select-Object -Last 3

if ($LASTEXITCODE -ne 0) { throw "avdmanager failed (exit $LASTEXITCODE)." }

$avds = & (Join-Path $Cmdline 'avdmanager.bat') list avd -c 2>&1
if ($avds -notcontains $AvdName) { throw "AVD '$AvdName' was not created." }

Write-Step 'Done'
Write-Host "AVD '$AvdName' is ready." -ForegroundColor Green
Write-Host "`nStart it (leave running):" -ForegroundColor Yellow
Write-Host "  & `"$SdkRoot\emulator\emulator.exe`" -avd $AvdName" -ForegroundColor Yellow
Write-Host "Then, in another terminal:  npx expo run:android" -ForegroundColor Yellow
