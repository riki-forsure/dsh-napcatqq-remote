[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string[]]$AllowedContacts,
    [string]$BotQQ = '',
    [string]$AccessToken = '',
    [string]$Distro = 'Ubuntu-24.04',
    [string]$LinuxUser = '',
    [string]$NapCatRoot = '',
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\NapCatQQ'),
    [string]$StatePath = (Join-Path $env:LOCALAPPDATA 'DshNapCatQQ\setup.json')
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'DshNapCat.Setup.psm1') -Force

foreach ($contact in $AllowedContacts) {
    if ([string]$contact -notmatch '^\d+$') { throw "AllowedContacts contains a non-numeric QQ identifier." }
}
if ($BotQQ -and $BotQQ -notmatch '^\d+$') { throw 'BotQQ must contain digits only.' }
if (-not $LinuxUser) {
    $LinuxUser = ([string]$env:USERNAME).ToLowerInvariant() -replace '[^a-z0-9_-]', ''
    if ($LinuxUser -notmatch '^[a-z_]') { $LinuxUser = 'dshuser' }
}

$candidatePaths = @()
if ($NapCatRoot) { $candidatePaths += $NapCatRoot }
$napcat = Get-NapCatInstallation -CandidatePaths $candidatePaths
if ($null -eq $napcat) {
    Write-Host 'NapCat was not detected. Downloading the latest official Shell OneKey package...'
    $napcat = Install-NapCatShell -InstallRoot $InstallRoot
} else {
    Write-Host ("Reusing detected NapCat {0}: {1}" -f $napcat.Kind, $napcat.Root)
}

Ensure-WslDistribution -Distro $Distro
Initialize-WslUser -Distro $Distro -LinuxUser $LinuxUser
Invoke-WslBootstrap -Distro $Distro -LinuxUser $LinuxUser

if (-not $AccessToken) { $AccessToken = New-RandomAccessToken }
$state = [pscustomobject][ordered]@{
    SchemaVersion = 1
    Distro = $Distro
    LinuxUser = $LinuxUser
    NapCatKind = $napcat.Kind
    NapCatRoot = $napcat.Root
    BotQQ = $BotQQ
    AllowedContacts = @($AllowedContacts | ForEach-Object { [string]$_ })
    EncryptedAccessToken = Protect-SetupSecret -PlainText $AccessToken
    InstalledAt = [DateTime]::UtcNow.ToString('o')
}
Write-DshNapCatState -State $state -Path $StatePath

$binPath = Join-Path (Split-Path -Parent $StatePath) 'bin'
Install-DshNapCatLauncherFiles -SourceDirectory $PSScriptRoot -BinPath $binPath
$shortcuts = Install-DshNapCatShortcuts -BinPath $binPath -StatePath $StatePath
Write-Host 'Desktop launchers created:'
$shortcuts | ForEach-Object { Write-Host ("  " + $_) }

Start-NapCatInstallation -Installation $napcat -BotQQ $BotQQ
$ready = Complete-DshNapCatSetup -StatePath $StatePath
if ($ready) {
    $state = Read-DshNapCatState -Path $StatePath
    if ([bool]$state.NapCatRestartRequired) {
        Restart-NapCatInstallation -Installation $napcat -BotQQ ([string]$state.BotQQ)
        $state.NapCatRestartRequired = $false
        Write-DshNapCatState -State $state -Path $StatePath
    }
    Start-DshWebIfNeeded -Distro $Distro -LinuxUser $LinuxUser | Out-Null
    Start-Process 'http://127.0.0.1:3080/'
    Write-Host 'Configuration is complete. The start shortcut can now reuse NapCat and DSH.'
} else {
    $managerScript = Join-Path $binPath 'open-napcat-manager.ps1'
    & $managerScript -StatePath $StatePath
    Write-Host 'Finish the QQ login or device verification, then double-click the DSH QQ bot start shortcut.'
}

Write-Host 'The routing suite is installed automatically when router-standard is missing.'
