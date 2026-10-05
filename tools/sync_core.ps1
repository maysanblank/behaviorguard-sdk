# sync_core.ps1 - satu sumber: sdk/core -> extension/core (fix R1)
# Jalankan tiap kali ubah sdk/core/* atau sebelum build extension
$ErrorActionPreference="Stop"
$root=$PSScriptRoot | Split-Path -Parent
$src=Join-Path $root "sdk\core"
$dst=Join-Path $root "extension\core"
if(-not (Test-Path $src)){ Write-Error "src not found: $src"; exit 1 }
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item -Path (Join-Path $src "*") -Destination $dst -Recurse -Force
Copy-Item -Path (Join-Path $root "sdk\storage.js") -Destination (Join-Path $root "extension\storage.js") -Force
# C-9: orkestrator dulu TIDAK ikut disinkron, jadi extension memakai salinan
# tangan yang basi: semua perbaikan MFA/step-up tidak pernah sampai ke sana.
Copy-Item -Path (Join-Path $root "sdk\behaviorguard.js") -Destination (Join-Path $root "extension\behaviorguard.js") -Force
Write-Host "SYNC OK: sdk/core -> extension/core"
Get-ChildItem $dst | Format-Table Name,Length
# S9: verifikasi semua file dengan normalisasi LF/CRLF
$diffAll=@()
foreach($f in Get-ChildItem $src){ $a=(Get-Content (Join-Path $src $f.Name) -Raw) -replace "\r\n","\n"; $b=(Get-Content (Join-Path $dst $f.Name) -Raw) -replace "\r\n","\n"; if($a -ne $b){ $diffAll+=$f.Name } }
# berkas tingkat-atas (storage + orkestrator) juga wajib identik
foreach($top in @("storage.js","behaviorguard.js")){
  $a=(Get-Content (Join-Path $root "sdk\$top") -Raw) -replace "`r`n","`n"
  $b=(Get-Content (Join-Path $root "extension\$top") -Raw) -replace "`r`n","`n"
  if($a -ne $b){ $diffAll+=$top }
}
if($diffAll){ Write-Error "Masih beda: $($diffAll -join ', ')"; exit 1 }
Write-Host "Verified: every core module and storage.js identical (LF/CRLF normalised)"
