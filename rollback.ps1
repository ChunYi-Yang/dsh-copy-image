# Roll back dsh-copy-image and restore dsh-chat-image-lightbox.
# Run in PowerShell:  powershell -NoProfile -ExecutionPolicy Bypass -File rollback.ps1
$ErrorActionPreference = "Stop"
$profileDir = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh\profiles\desktop'
$pkg = Join-Path $profileDir "package.json"

Write-Host "Backing up profile package.json ..."
Copy-Item $pkg "$pkg.rollback-backup" -Force

Write-Host "Removing dsh-copy-image from bundles and dependencies ..."
$dsh = "D:\DeepSeek\resources\runtime\cli\bin\dsh.cmd"
& $dsh plugin --profile desktop remove dsh-copy-image

Write-Host "Re-enabling dsh-chat-image-lightbox ..."
$j = Get-Content $pkg -Raw | ConvertFrom-Json
if ($j.dsh.profile.bundles -notcontains "dsh-chat-image-lightbox") {
    $j.dsh.profile.bundles += "dsh-chat-image-lightbox"
}
Set-Content $pkg ($j | ConvertTo-Json -Depth 20) -Encoding UTF8

Write-Host "Done. Fully quit DSH and reopen."
