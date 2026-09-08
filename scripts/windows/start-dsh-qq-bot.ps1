[CmdletBinding()]
param(
    [string]$StatePath = (Join-Path $env:LOCALAPPDATA 'DshNapCatQQ\setup.json')
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'DshNapCat.Setup.psm1') -Force

$state = Read-DshNapCatState -Path $StatePath
$napcat = Get-NapCatInstallation -CandidatePaths @([string]$state.NapCatRoot) -IncludeDefaultCandidates $false
if ($null -eq $napcat) { throw 'NapCat was not found. Rerun install-full-stack.ps1.' }

$knownBot = [string]$state.BotQQ
if (-not $knownBot) { $knownBot = Get-NapCatBotAccount -Installation $napcat }
Start-NapCatInstallation -Installation $napcat -BotQQ $knownBot

$ready = $false
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    $ready = Complete-DshNapCatSetup -StatePath $StatePath
    if ($ready) { break }
    Start-Sleep -Milliseconds 500
}
if (-not $ready) {
    & (Join-Path $PSScriptRoot 'open-napcat-manager.ps1') -StatePath $StatePath
    throw 'QQ login is not complete yet. Finish login, then run this shortcut again.'
}

$state = Read-DshNapCatState -Path $StatePath
if ([bool]$state.NapCatRestartRequired) {
    Restart-NapCatInstallation -Installation $napcat -BotQQ ([string]$state.BotQQ)
    $state.NapCatRestartRequired = $false
    Write-DshNapCatState -State $state -Path $StatePath
}
Start-DshWebIfNeeded -Distro ([string]$state.Distro) -LinuxUser ([string]$state.LinuxUser) | Out-Null
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    if (Test-LocalTcpPort -Port 3080) { break }
    Start-Sleep -Milliseconds 500
}
Start-Process 'http://127.0.0.1:3080/'
