[CmdletBinding()]
param(
    [string]$ExamplePath = (Join-Path $PSScriptRoot '..\.env.example'),
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\.env')
)

$ErrorActionPreference = 'Stop'

$resolvedExample = [System.IO.Path]::GetFullPath($ExamplePath)
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$cmsRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

if (-not $resolvedOutput.StartsWith($cmsRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Файл с секретами можно создавать только внутри каталога cms.'
}
if (Test-Path -LiteralPath $resolvedOutput) {
    throw "Файл уже существует: $resolvedOutput"
}

function New-Secret([int]$ByteCount = 48) {
    $bytes = [byte[]]::new($ByteCount)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$content = Get-Content -Raw -LiteralPath $resolvedExample
$content = $content.Replace('CHANGE_ME_GENERATE_WITH_SCRIPT', (New-Secret 64))
$content = $content.Replace('CHANGE_ME_OWNER_PASSWORD', (New-Secret 32))
$content = $content.Replace('CHANGE_ME_DATABASE_PASSWORD', (New-Secret 48))

[System.IO.File]::WriteAllText($resolvedOutput, $content, [System.Text.UTF8Encoding]::new($false))

Write-Host "Создан файл $resolvedOutput"
Write-Host 'Укажите реальный email, SMTP-параметры и лицензионный ключ, затем запустите check-env.mjs.'
