# Build the release tarball that `tarball:` in the catalog entry points at.
#
# The asset name is deliberately version-free. `releases/latest/download/<name>`
# resolves `latest` at request time but takes the filename literally, so a
# versioned name works on release day and 404s on the next one.
#
#   pwsh -File scripts/pack.ps1
#
# Output: dist/dsh-copy-image.tgz  (upload it to the GitHub Release as
#         `dsh-copy-image.tgz`, replacing any existing asset of that name)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "package"
$tgz = Join-Path $dist "dsh-copy-image.tgz"

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# Only what `files[]` in package.json claims, so the tarball matches a
# published npm package rather than a checkout.
foreach ($f in @("package.json", "cordis.patch.yml", "LICENSE", "README.md", "icon.svg")) {
    Copy-Item (Join-Path $root $f) -Destination $stage
}
foreach ($d in @("lib", "locale")) {
    Copy-Item (Join-Path $root $d) -Destination $stage -Recurse
}

Push-Location $dist
try {
    tar -czf $tgz package
} finally {
    Pop-Location
    Remove-Item $stage -Recurse -Force
}

Write-Host ("built {0} ({1} bytes)" -f $tgz, (Get-Item $tgz).Length)
tar -tzf $tgz