$ErrorActionPreference = 'Stop'

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "ASSERT: $Message" }
}

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -ne $Expected) { throw "ASSERT: $Message (actual=$Actual expected=$Expected)" }
}

$modulePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'DshNapCat.Setup.psm1'
Import-Module $modulePath -Force

$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-napcat-tests-" + [guid]::NewGuid().ToString('N'))
try {
    $shellRoot = Join-Path $fixtureRoot 'NapCat.Shell'
    $desktopRoot = Join-Path $fixtureRoot 'NapCat Desktop'
    New-Item -ItemType Directory -Path (Join-Path $shellRoot 'config') -Force | Out-Null
    New-Item -ItemType Directory -Path $desktopRoot -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $shellRoot 'NapCatWinBootMain.exe') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $shellRoot 'launcher-user.bat') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $desktopRoot 'NapCatQQ Desktop.exe') -Force | Out-Null

    $installation = Get-NapCatInstallation -CandidatePaths @($desktopRoot, $shellRoot) -IncludeDefaultCandidates $false
    Assert-Equal $installation.Kind 'Shell' 'Shell should be preferred when Shell and Desktop both exist'
    Assert-Equal $installation.Root $shellRoot 'Detected Shell root should be exact'

    $desktopOnly = Get-NapCatInstallation -CandidatePaths @($desktopRoot) -IncludeDefaultCandidates $false
    Assert-Equal $desktopOnly.Kind 'Desktop' 'Desktop should be detected when Shell is absent'

    $server = New-OneBotWebSocketServer -HostName '127.0.0.1' -Port 3001 -AccessToken 'fixture-token'
    Assert-True $server.enable 'OneBot server should be enabled'
    Assert-Equal $server.name 'dsh-qq-channel' 'OneBot server should use a stable name'
    Assert-Equal $server.messagePostFormat 'array' 'OneBot messages should use array format'
    Assert-True (-not $server.reportSelfMessage) 'Self messages should stay disabled'

    $firstWrite = Set-NapCatOneBotConfig -ShellRoot $shellRoot -BotQQ '10000' -AccessToken 'fixture-token'
    $secondWrite = Set-NapCatOneBotConfig -ShellRoot $shellRoot -BotQQ '10000' -AccessToken 'fixture-token'
    Assert-True $firstWrite.Changed 'First OneBot configuration write should report a change'
    Assert-True (-not $secondWrite.Changed) 'Repeated identical OneBot configuration should be idempotent'
    Assert-Equal $secondWrite.BackupPath $null 'An unchanged OneBot configuration should not create a backup'
    $storedOneBot = Get-Content -LiteralPath $firstWrite.Path -Raw | ConvertFrom-Json
    $storedServer = @($storedOneBot.network.websocketServers | Where-Object { $_.name -eq 'dsh-qq-channel' })
    Assert-Equal $storedServer.Count 1 'OneBot configuration should contain exactly one DSH server'

    $existingPluginConfig = [pscustomobject]@{
        allowedContacts = @('old-contact')
        websocketUrl = 'ws://old:3001'
        accessToken = 'old-token'
        stylePromptFile = '/home/user/custom-style.md'
        agentPreset = 'router-auto'
        agentModel = 'custom-vision-model'
    }
    $mergedPluginConfig = Merge-DshPluginConfig -Existing $existingPluginConfig -AllowedContacts @('10001', '10002') -WebSocketUrl 'ws://host:3001' -AccessToken 'new-token' -DefaultAgentPreset 'router-standard'
    Assert-Equal $mergedPluginConfig.stylePromptFile '/home/user/custom-style.md' 'Existing style path should be preserved'
    Assert-Equal $mergedPluginConfig.agentPreset 'router-auto' 'Existing preferred preset should be preserved'
    Assert-Equal $mergedPluginConfig.agentModel 'custom-vision-model' 'Existing model should be preserved'
    Assert-Equal $mergedPluginConfig.websocketUrl 'ws://host:3001' 'Connection URL should be updated'
    Assert-Equal $mergedPluginConfig.accessToken 'new-token' 'Connection token should be updated'
    Assert-Equal $mergedPluginConfig.allowedContacts.Count 2 'Allowed contacts should be updated'

    $protected = Protect-SetupSecret -PlainText 'fixture-token'
    Assert-True ($protected -notmatch 'fixture-token') 'Protected setup state must not contain the plain token'
    Assert-Equal (Unprotect-SetupSecret -CipherText $protected) 'fixture-token' 'Protected token should round-trip for the current user'

    $definitions = Get-DshNapCatShortcutDefinitions -BinPath 'C:\Fixture\bin' -StatePath 'C:\Fixture\setup.json'
    $startShortcutName = '"\u542f\u52a8 DSH QQ \u673a\u5668\u4eba"' | ConvertFrom-Json
    $manageShortcutName = '"NapCat \u767b\u5f55\u4e0e\u7ba1\u7406"' | ConvertFrom-Json
    Assert-Equal $definitions.Count 2 'Exactly two desktop shortcuts should be defined'
    Assert-True ($definitions.Name -contains $startShortcutName) 'Start shortcut should be present'
    Assert-True ($definitions.Name -contains $manageShortcutName) 'NapCat management shortcut should be present'
    Assert-True (($definitions.Arguments -join "`n") -notmatch 'fixture-token') 'Shortcut arguments must not expose a token'

    $bootstrap = New-WslBootstrapScript -LinuxUser 'fixtureuser' -PluginRepository 'https://github.com/riki-forsure/dsh-napcatqq-remote.git' -RoutingRepository 'github:yjh051108/dsh-routing-suite'
    Assert-True ($bootstrap -match 'dsh-routing-suite') 'Bootstrap should install the recommended routing suite'
    Assert-True ($bootstrap -match 'router-standard') 'Bootstrap should check for the installed router preset'
    Assert-True ($bootstrap -match 'dsh plugin --profile web add') 'Bootstrap should add plugins to the web profile'

    Write-Host 'DshNapCat.Setup tests passed'
} finally {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
}
