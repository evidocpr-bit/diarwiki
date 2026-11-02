param(
  [Parameter(Mandatory = $true)]
  [string]$EditorEmail,

  [Parameter(Mandatory = $true)]
  [string]$HostName,
  [string]$DeployUser = 'diarwiki',
  [string]$KeyPath = "$env:USERPROFILE\.ssh\diarwiki_ed25519"
)

$ErrorActionPreference = 'Stop'
$siteDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repositoryDirectory = (Resolve-Path (Join-Path $siteDirectory '..')).Path
$archive = $null
$remoteVerifier = $null
$remoteVerifierUploaded = $false

Push-Location $siteDirectory
try {
  $siteChanges = @(git -c "safe.directory=$repositoryDirectory" status --porcelain -- .)
  if ($siteChanges.Count -gt 0) {
    throw "Publishing requires a clean site directory.`n$($siteChanges -join "`n")"
  }

  $shortCommit = (git -c "safe.directory=$repositoryDirectory" rev-parse --short=12 HEAD).Trim()
  $utcNow = [DateTime]::UtcNow
  $invariantCulture = [Globalization.CultureInfo]::InvariantCulture
  $releaseId = "$($utcNow.ToString('yyyyMMddTHHmmssZ', $invariantCulture))-$shortCommit"
  $builtAt = $utcNow.ToString('yyyy-MM-ddTHH:mm:ssZ', $invariantCulture)
  $archive = Join-Path $env:TEMP "diarwiki-$releaseId.tar.gz"
  $remoteArchive = "/tmp/diarwiki-$releaseId.tar.gz"

  $env:ASTRO_TELEMETRY_DISABLED = '1'
  $env:PUBLIC_SITE_INDEXABLE = 'true'
  $env:PUBLIC_EDITOR_EMAIL = $EditorEmail
  $env:PUBLIC_RELEASE_ID = $releaseId
  $env:PUBLIC_SOURCE_COMMIT = $shortCommit
  $env:PUBLIC_BUILD_AT = $builtAt

  pnpm test
  if ($LASTEXITCODE -ne 0) { throw 'Unit tests failed.' }
  pnpm build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }

  tar -czf $archive -C dist .
  if ($LASTEXITCODE -ne 0) { throw 'Release archive could not be created.' }
  $archiveSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()

  $previousReleaseCommand = 'if [ -L /srv/diarwiki/current ]; then basename "$(readlink -f /srv/diarwiki/current)"; fi'
  $previousReleaseOutput = ssh -i $KeyPath "${DeployUser}@${HostName}" $previousReleaseCommand
  if ($LASTEXITCODE -ne 0) { throw 'Current release could not be read.' }
  $previousRelease = ($previousReleaseOutput | Out-String).Trim()

  scp -i $KeyPath $archive "${DeployUser}@${HostName}:$remoteArchive"
  if ($LASTEXITCODE -ne 0) { throw 'Release archive upload failed.' }
  $remoteVerifier = "/tmp/diarwiki-verify-release-$releaseId.sh"
  scp -i $KeyPath (Join-Path $PSScriptRoot 'verify-release.sh') "${DeployUser}@${HostName}:$remoteVerifier"
  if ($LASTEXITCODE -ne 0) { throw 'Release verifier upload failed.' }
  $remoteVerifierUploaded = $true

  ssh -i $KeyPath "${DeployUser}@${HostName}" "/usr/local/sbin/diarwiki-activate '$releaseId' '$remoteArchive' '$archiveSha256'"
  if ($LASTEXITCODE -ne 0) { throw 'Release activation failed.' }

  ssh -i $KeyPath "${DeployUser}@${HostName}" "bash '$remoteVerifier' '$releaseId'"
  $verificationExitCode = $LASTEXITCODE
  ssh -i $KeyPath "${DeployUser}@${HostName}" "rm -f -- '$remoteVerifier'" | Out-Null
  $remoteVerifierUploaded = $false
  if ($verificationExitCode -ne 0) {
    ssh -i $KeyPath "${DeployUser}@${HostName}" "/usr/local/sbin/diarwiki-record-release '$releaseId' failed"
    if ($previousRelease -match '^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{7,40}$') {
      ssh -i $KeyPath "${DeployUser}@${HostName}" "/usr/local/sbin/diarwiki-rollback '$previousRelease'"
    }
    throw "Live verification failed. Rolled back to $previousRelease."
  }

  ssh -i $KeyPath "${DeployUser}@${HostName}" "/usr/local/sbin/diarwiki-record-release '$releaseId' passed"
  if ($LASTEXITCODE -ne 0) { throw 'Release passed, but the verification result could not be recorded.' }

  node scripts/submit-indexnow.mjs
  if ($LASTEXITCODE -ne 0) { Write-Warning 'Release is live, but IndexNow notification failed.' }
  Write-Output "Published and verified release $releaseId (sha256=$archiveSha256)"
}
finally {
  if ($remoteVerifierUploaded -and $remoteVerifier) {
    ssh -i $KeyPath "${DeployUser}@${HostName}" "rm -f -- '$remoteVerifier'" | Out-Null
  }
  if ($archive -and (Test-Path -LiteralPath $archive)) {
    Remove-Item -LiteralPath $archive
  }
  Pop-Location
}
