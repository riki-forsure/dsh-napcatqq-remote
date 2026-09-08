[CmdletBinding()]
param(
    [string]$StatePath = (Join-Path $env:LOCALAPPDATA 'DshNapCatQQ\setup.json')
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'DshNapCat.Setup.psm1') -Force

$state = Read-DshNapCatState -Path $StatePath
$napcat = Get-NapCatInstallation -CandidatePaths @([string]$state.NapCatRoot) -IncludeDefaultCandidates $false
if ($null -eq $napcat) { throw 'NapCat was not found. Rerun install-full-stack.ps1.' }
$botQQ = [string]$state.BotQQ
if (-not $botQQ) { $botQQ = Get-NapCatBotAccount -Installation $napcat }
Start-NapCatInstallation -Installation $napcat -BotQQ $botQQ

if ($napcat.Kind -eq 'Shell') {
    $port = Get-NapCatWebUiPort -Installation $napcat
    for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
        if (Test-LocalTcpPort -Port $port) { break }
        Start-Sleep -Milliseconds 500
    }
    Start-Process ("http://127.0.0.1:{0}/" -f $port)
}
