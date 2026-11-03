# Vendor a portable Tesseract for the Windows bundle.
#
# Windows has no package manager to depend on, and "install Tesseract first" is exactly the extra
# step the installer exists to remove -- so the engine ships inside it. The UB-Mannheim build is
# upstream's only maintained Windows binary; its installer is NSIS, so 7-Zip extracts the payload
# without running it. Tesseract is Apache-2.0 and Leptonica is BSD-2-Clause, both compatible with
# this project's GPL-3.0-only, and both are credited in THIRD_PARTY_NOTICES.md.
#
# Only what the OCR path actually calls is kept: the executable, the DLLs beside it, and English
# training data. The full install is ~600 MB of language packs the reward reader never opens.
#
# The version is pinned to one that exists: UB-Mannheim serves a flat directory and prunes it, so a
# version that was current when this was written is not necessarily still downloadable. 5.5.0 was
# named here and 404s; check https://digi.bib.uni-mannheim.de/tesseract/ before bumping, because
# the failure lands in the release build rather than in CI.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'download-with-retry.ps1')


$version = '5.4.0.20240606'
$url = "https://digi.bib.uni-mannheim.de/tesseract/tesseract-ocr-w64-setup-$version.exe"
# The installer's SHA-256, checked before anything is extracted from it. UB Mannheim publishes no
# checksums, so this one was taken from two independent sources that agree: the file downloaded
# from the URL above on 3 November 2026, and the InstallerSha256 that winget's community
# repository has recorded for this version since June 2024
# (microsoft/winget-pkgs, manifests/u/UB-Mannheim/TesseractOCR/5.4.0.20240606, which lists
# UB Mannheim's GitHub release of the same file). Bumping the version means a new hash, checked the
# same way.
$sha256 = 'C885FFF6998E0608BA4BB8AB51436E1C6775C2BAFC2559A19B423E18678B60C9'
$root = Split-Path -Parent $PSScriptRoot
$vendor = Join-Path $root 'app/src-tauri/vendor/tesseract'
$staging = Join-Path $env:RUNNER_TEMP 'tesseract-extract'

if (Test-Path (Join-Path $vendor 'tesseract.exe')) {
  Write-Host 'tesseract already vendored'
  exit 0
}

$installer = Join-Path $env:RUNNER_TEMP 'tesseract-setup.exe'
Invoke-DownloadWithRetry -Uri $url -OutFile $installer
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash
if ($actual -ne $sha256) {
  Remove-Item -Force $installer -ErrorAction SilentlyContinue
  throw "the Tesseract installer's SHA-256 is $actual, not the pinned $sha256: not extracting it"
}
Write-Host "tesseract installer SHA-256 verified ($sha256)"
Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
& 7z x $installer "-o$staging" | Out-Null

New-Item -ItemType Directory -Force -Path $vendor | Out-Null
Copy-Item (Join-Path $staging 'tesseract.exe') $vendor
Copy-Item (Join-Path $staging '*.dll') $vendor
Copy-Item (Join-Path $staging 'tessdata/eng.traineddata') $vendor
Copy-Item (Join-Path $staging 'tessdata/osd.traineddata') $vendor

# A missing DLL turns every reward read into "tesseract is not available" at the one moment the
# player is watching, so the bundle is proven to run here rather than on their machine.
$probe = & (Join-Path $vendor 'tesseract.exe') --tessdata-dir $vendor --version
if ($LASTEXITCODE -ne 0) { throw 'the vendored tesseract does not run' }
Write-Host $probe

# Their notices, in licenses/ beside them: Tesseract's licence and authors from the installer,
# Leptonica's licence and the table of every DLL's project and licence
# (packaging/windows-tesseract/), and the list of the DLLs copied here.
$licenses = Join-Path $vendor 'licenses'
New-Item -ItemType Directory -Force -Path $licenses | Out-Null
Copy-Item (Join-Path $staging 'doc/LICENSE') (Join-Path $licenses 'tesseract-LICENSE.txt')
Copy-Item (Join-Path $staging 'doc/AUTHORS') (Join-Path $licenses 'tesseract-AUTHORS.txt')
Copy-Item (Join-Path $root 'packaging/windows-tesseract/*') $licenses
$dlls = Get-ChildItem -LiteralPath $vendor -Filter '*.dll' | Sort-Object Name | ForEach-Object { $_.Name }
@("From UB Mannheim's tesseract-ocr-w64-setup-$version.exe (SHA-256 $sha256):", 'tesseract.exe') + $dlls |
  Set-Content -LiteralPath (Join-Path $licenses 'DLLS.txt') -Encoding utf8
