$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$appVersion = (Get-Content (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json).version
$buildDir = Join-Path $projectRoot "dist\stable-win-x64"
$buildArchivePath = Join-Path $buildDir "StickyNotes.tar.zst"
$tarPath = Join-Path $buildDir "StickyNotes.tar"
$packageDir = Join-Path $projectRoot "dist\windows-installer"
$appDir = Join-Path $packageDir "StickyNotes"
$launcherPath = Join-Path $appDir "bin\launcher.exe"
$appPath = Join-Path $appDir "bin\StickyNotes.exe"
$bunPath = Join-Path $appDir "bin\bun.exe"
$iconPath = Join-Path $projectRoot "build\windows\icon.ico"
$zstdPath = Join-Path $projectRoot "node_modules\electrobun\dist-win-x64\zig-zstd.exe"
$rceditPath = Join-Path $projectRoot "node_modules\rcedit\bin\rcedit-x64.exe"
$compilerPath = Join-Path $projectRoot ".tools\inno\compiler\ISCC.exe"
$scriptPath = Join-Path $projectRoot "build\windows\installer.iss"
$artifactDir = Join-Path $projectRoot "artifacts"
$artifactArchivePath = Join-Path $artifactDir "stable-win-x64-StickyNotes.tar.zst"

function Set-GuiSubsystem {
  param([string]$Path)

  $bytes = [IO.File]::ReadAllBytes($Path)
  $peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
  $subsystemOffset = $peOffset + 92
  $bytes[$subsystemOffset] = 2
  $bytes[$subsystemOffset + 1] = 0
  [IO.File]::WriteAllBytes($Path, $bytes)
}

if (-not (Test-Path $compilerPath)) {
  throw "Inno Setup compiler not found: $compilerPath"
}

$buildStartedAt = Get-Date
& npm.cmd run build
$buildExitCode = $LASTEXITCODE
$archive = Get-Item $artifactArchivePath -ErrorAction SilentlyContinue
if (-not $archive) {
  $archive = Get-Item $buildArchivePath -ErrorAction SilentlyContinue
}

if (-not $archive -or $archive.LastWriteTime -lt $buildStartedAt) {
  throw "Electrobun did not create a fresh release archive"
}
$archivePath = $archive.FullName

if ($buildExitCode -ne 0) {
  Write-Warning "Electrobun ZIP wrapping failed; continuing with the fresh release archive"
}

if (Test-Path $tarPath) {
  Remove-Item -LiteralPath $tarPath -Force
}

if (Test-Path $packageDir) {
  Remove-Item -LiteralPath $packageDir -Recurse -Force
}

New-Item -ItemType Directory -Path $packageDir | Out-Null
& $zstdPath decompress -i $archivePath -o $tarPath --no-timing
if ($LASTEXITCODE -ne 0) {
  throw "Failed to decompress the Electrobun release archive"
}

tar -xf $tarPath -C $packageDir
if ($LASTEXITCODE -ne 0) {
  throw "Failed to extract the Electrobun release archive"
}

Remove-Item -LiteralPath $tarPath -Force
Move-Item -LiteralPath $launcherPath -Destination $appPath

& $rceditPath $appPath --set-icon $iconPath --set-version-string ProductName "Sticky Notes" --set-version-string FileDescription "Sticky Notes" --set-file-version $appVersion --set-product-version $appVersion
if ($LASTEXITCODE -ne 0) {
  throw "Failed to update the application icon and version metadata"
}

& $rceditPath $bunPath --set-icon $iconPath
if ($LASTEXITCODE -ne 0) {
  throw "Failed to update the runtime icon"
}

Set-GuiSubsystem -Path $appPath
Set-GuiSubsystem -Path $bunPath

& $compilerPath "/DAppVersion=$appVersion" "/DSourceDir=$appDir" "/DOutputDir=$artifactDir" $scriptPath
if ($LASTEXITCODE -ne 0) {
  throw "Failed to create the Windows installer"
}
