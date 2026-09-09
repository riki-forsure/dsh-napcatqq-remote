Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Get-JsonString {
    param([Parameter(Mandatory = $true)][string]$Escaped)
    return ('"' + $Escaped + '"') | ConvertFrom-Json
}

function Set-ObjectProperty {
    param(
        [Parameter(Mandatory = $true)]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name,
        $Value
    )
    if ($null -eq $InputObject.PSObject.Properties[$Name]) {
        $InputObject | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    } else {
        $InputObject.$Name = $Value
    }
}

function Get-ShortcutTarget {
    param([Parameter(Mandatory = $true)][string]$Path)
    try {
        $shell = New-Object -ComObject WScript.Shell
        return $shell.CreateShortcut($Path).TargetPath
    } catch {
        return $null
    }
}

function Get-DefaultNapCatCandidatePaths {
    $items = New-Object System.Collections.Generic.List[string]
    foreach ($processName in @('NapCatWinBootMain', 'NapCatQQ', 'NapCatQQ Desktop', 'NapCatQQ-Desktop')) {
        foreach ($process in @(Get-Process -Name $processName -ErrorAction SilentlyContinue)) {
            if ($process.Path) { $items.Add($process.Path) }
        }
    }
    $desktop = [Environment]::GetFolderPath('Desktop')
    if (Test-Path -LiteralPath $desktop) {
        foreach ($shortcut in @(Get-ChildItem -LiteralPath $desktop -Filter '*NapCat*.lnk' -File -ErrorAction SilentlyContinue)) {
            $target = Get-ShortcutTarget -Path $shortcut.FullName
            if ($target) { $items.Add($target) }
        }
    }
    foreach ($path in @(
        $env:NAPCAT_HOME,
        (Join-Path $env:LOCALAPPDATA 'Programs\NapCatQQ'),
        (Join-Path $env:LOCALAPPDATA 'NapCatQQ'),
        (Join-Path $env:ProgramData 'NapCatQQ Desktop'),
        (Join-Path $env:ProgramFiles 'NapCatQQ')
    )) {
        if ($path) { $items.Add($path) }
    }
    return @($items | Select-Object -Unique)
}

function Get-NapCatInstallation {
    [CmdletBinding()]
    param(
        [string[]]$CandidatePaths = @(),
        [bool]$IncludeDefaultCandidates = $true
    )

    $paths = @($CandidatePaths)
    if ($IncludeDefaultCandidates) { $paths += @(Get-DefaultNapCatCandidatePaths) }
    $roots = New-Object System.Collections.Generic.List[string]
    foreach ($candidate in $paths) {
        if (-not $candidate) { continue }
        $expanded = [Environment]::ExpandEnvironmentVariables([string]$candidate)
        if (-not (Test-Path -LiteralPath $expanded)) { continue }
        $item = Get-Item -LiteralPath $expanded
        $root = if ($item.PSIsContainer) { $item.FullName } else { $item.Directory.FullName }
        $roots.Add($root)
        if ((Split-Path -Leaf $root) -ne 'NapCat.Shell') {
            $shellChild = Join-Path $root 'NapCat.Shell'
            if (Test-Path -LiteralPath $shellChild) { $roots.Add($shellChild) }
        }
    }

    foreach ($root in @($roots | Select-Object -Unique)) {
        $boot = Join-Path $root 'NapCatWinBootMain.exe'
        $userLauncher = Join-Path $root 'launcher-user.bat'
        $oneKeyLauncher = Join-Path $root 'napcat.bat'
        $launcher = if (Test-Path -LiteralPath $userLauncher) { $userLauncher } elseif (Test-Path -LiteralPath $oneKeyLauncher) { $oneKeyLauncher } else { $boot }
        if ((Test-Path -LiteralPath $boot) -or (Test-Path -LiteralPath $userLauncher) -or (Test-Path -LiteralPath $oneKeyLauncher)) {
            return [pscustomobject]@{
                Kind = 'Shell'
                Root = $root
                Launcher = $launcher
                ManagerExecutable = $boot
            }
        }
    }

    foreach ($root in @($roots | Select-Object -Unique)) {
        foreach ($name in @('NapCatQQ Desktop.exe', 'NapCatQQ-Desktop.exe', 'NapCatQQ.exe')) {
            $executable = Join-Path $root $name
            if (Test-Path -LiteralPath $executable) {
                return [pscustomobject]@{
                    Kind = 'Desktop'
                    Root = $root
                    Launcher = $executable
                    ManagerExecutable = $executable
                }
            }
        }
    }
    return $null
}

function Get-LatestNapCatOneKeyAsset {
    [CmdletBinding()]
    param([string]$ApiUrl = 'https://api.github.com/repos/NapNeko/NapCatQQ/releases/latest')
    $headers = @{ 'User-Agent' = 'dsh-napcatqq-remote-installer' }
    $release = Invoke-RestMethod -Uri $ApiUrl -Headers $headers
    $asset = @($release.assets | Where-Object { $_.name -eq 'NapCat.Shell.Windows.OneKey.zip' }) | Select-Object -First 1
    if ($null -eq $asset) { throw 'The latest official NapCatQQ release has no NapCat.Shell.Windows.OneKey.zip asset.' }
    return [pscustomobject]@{
        Version = [string]$release.tag_name
        Name = [string]$asset.name
        Url = [string]$asset.browser_download_url
        Size = [long]$asset.size
    }
}

function Install-NapCatShell {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [string]$DownloadUrl
    )
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
    if (-not $DownloadUrl) { $DownloadUrl = (Get-LatestNapCatOneKeyAsset).Url }
    $archive = Join-Path ([System.IO.Path]::GetTempPath()) ("NapCat-OneKey-" + [guid]::NewGuid().ToString('N') + '.zip')
    try {
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $archive -UseBasicParsing
        Expand-Archive -LiteralPath $archive -DestinationPath $InstallRoot -Force
        $installer = Join-Path $InstallRoot 'NapCatInstaller.exe'
        if (Test-Path -LiteralPath $installer) {
            $process = Start-Process -FilePath $installer -WorkingDirectory $InstallRoot -WindowStyle Hidden -Wait -PassThru
            if ($process.ExitCode -ne 0) { throw "NapCatInstaller.exe exited with code $($process.ExitCode)." }
        }
    } finally {
        Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
    }
    $installation = Get-NapCatInstallation -CandidatePaths @($InstallRoot) -IncludeDefaultCandidates $false
    if ($null -eq $installation -or $installation.Kind -ne 'Shell') {
        $found = Get-ChildItem -LiteralPath $InstallRoot -Filter 'NapCatWinBootMain.exe' -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.Directory.Name -ne 'bootmain' } |
            Sort-Object @{ Expression = { if ($_.Directory.Name -match '^NapCat\..*\.Shell$') { 0 } else { 1 } } }, FullName |
            Select-Object -First 1
        if ($found) { $installation = Get-NapCatInstallation -CandidatePaths @($found.FullName) -IncludeDefaultCandidates $false }
    }
    if ($null -eq $installation -or $installation.Kind -ne 'Shell') { throw 'NapCat Shell was extracted but its launcher was not found.' }
    return $installation
}

function New-OneBotWebSocketServer {
    [CmdletBinding()]
    param(
        [string]$HostName = '0.0.0.0',
        [int]$Port = 3001,
        [string]$AccessToken = ''
    )
    return [pscustomobject][ordered]@{
        enable = $true
        name = 'dsh-qq-channel'
        host = $HostName
        port = $Port
        messagePostFormat = 'array'
        reportSelfMessage = $false
        enableForcePushEvent = $true
        token = $AccessToken
        debug = $false
        heartInterval = 30000
    }
}

function Backup-FileIfPresent {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = "$Path.backup-$stamp"
    Copy-Item -LiteralPath $Path -Destination $backup
    return $backup
}

function Set-NapCatOneBotConfig {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ShellRoot,
        [Parameter(Mandatory = $true)][ValidatePattern('^\d+$')][string]$BotQQ,
        [Parameter(Mandatory = $true)][string]$AccessToken,
        [string]$HostName = '0.0.0.0',
        [int]$Port = 3001
    )
    $configDirectory = Join-Path $ShellRoot 'config'
    New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
    $path = Join-Path $configDirectory ("onebot11_$BotQQ.json")
    if (Test-Path -LiteralPath $path) {
        $config = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    } else {
        $config = [pscustomobject]@{}
    }
    if ($null -eq $config.PSObject.Properties['network']) {
        Set-ObjectProperty -InputObject $config -Name 'network' -Value ([pscustomobject]@{})
    }
    foreach ($name in @('httpServers', 'httpSseServers', 'httpClients', 'websocketClients', 'plugins')) {
        if ($null -eq $config.network.PSObject.Properties[$name]) {
            Set-ObjectProperty -InputObject $config.network -Name $name -Value @()
        }
    }
    $servers = @()
    if ($null -ne $config.network.PSObject.Properties['websocketServers']) {
        $allServers = @($config.network.websocketServers)
        $managed = @($allServers | Where-Object { $_.name -eq 'dsh-qq-channel' })
        if ($managed.Count -eq 1) {
            $current = $managed[0]
            $unchanged = $current.enable -eq $true `
                -and [string]$current.host -eq $HostName `
                -and [int]$current.port -eq $Port `
                -and [string]$current.messagePostFormat -eq 'array' `
                -and $current.reportSelfMessage -eq $false `
                -and $current.enableForcePushEvent -eq $true `
                -and [string]$current.token -eq $AccessToken `
                -and $current.debug -eq $false `
                -and [int]$current.heartInterval -eq 30000
            if ($unchanged) {
                return [pscustomobject]@{ Path = $path; BackupPath = $null; Changed = $false }
            }
        }
        $servers = @($allServers | Where-Object { $_.name -ne 'dsh-qq-channel' })
    }
    $servers += New-OneBotWebSocketServer -HostName $HostName -Port $Port -AccessToken $AccessToken
    Set-ObjectProperty -InputObject $config.network -Name 'websocketServers' -Value $servers
    $backup = Backup-FileIfPresent -Path $path
    [System.IO.File]::WriteAllText($path, (($config | ConvertTo-Json -Depth 32) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
    return [pscustomobject]@{ Path = $path; BackupPath = $backup; Changed = $true }
}

function Protect-SetupSecret {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$PlainText)
    $secure = ConvertTo-SecureString -String $PlainText -AsPlainText -Force
    return ConvertFrom-SecureString -SecureString $secure
}

function Unprotect-SetupSecret {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$CipherText)
    $secure = ConvertTo-SecureString -String $CipherText
    $credential = New-Object System.Management.Automation.PSCredential('dsh-napcatqq', $secure)
    return $credential.GetNetworkCredential().Password
}

function New-RandomAccessToken {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_'))
}

function Get-DshNapCatShortcutDefinitions {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$BinPath,
        [Parameter(Mandatory = $true)][string]$StatePath
    )
    $powershell = Join-Path $PSHOME 'powershell.exe'
    $startName = Get-JsonString -Escaped '\u542f\u52a8 DSH QQ \u673a\u5668\u4eba'
    $manageName = Get-JsonString -Escaped 'NapCat \u767b\u5f55\u4e0e\u7ba1\u7406'
    return @(
        [pscustomobject]@{
            Name = $startName
            TargetPath = $powershell
            Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $BinPath 'start-dsh-qq-bot.ps1')`" -StatePath `"$StatePath`""
            WorkingDirectory = $BinPath
            Description = 'Start or reuse NapCat and one DSH WebUI, then open the QQ workspace WebUI.'
        },
        [pscustomobject]@{
            Name = $manageName
            TargetPath = $powershell
            Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $BinPath 'open-napcat-manager.ps1')`" -StatePath `"$StatePath`""
            WorkingDirectory = $BinPath
            Description = 'Open the detected NapCat Shell or NapCat Desktop login and management interface.'
        }
    )
}

function Install-DshNapCatShortcuts {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$BinPath,
        [Parameter(Mandatory = $true)][string]$StatePath,
        [string]$DesktopPath = [Environment]::GetFolderPath('Desktop')
    )
    $shell = New-Object -ComObject WScript.Shell
    $created = @()
    foreach ($definition in @(Get-DshNapCatShortcutDefinitions -BinPath $BinPath -StatePath $StatePath)) {
        $path = Join-Path $DesktopPath ($definition.Name + '.lnk')
        $shortcut = $shell.CreateShortcut($path)
        $shortcut.TargetPath = $definition.TargetPath
        $shortcut.Arguments = $definition.Arguments
        $shortcut.WorkingDirectory = $definition.WorkingDirectory
        $shortcut.Description = $definition.Description
        $shortcut.Save()
        $created += $path
    }
    return $created
}

function Install-DshNapCatLauncherFiles {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$SourceDirectory,
        [Parameter(Mandatory = $true)][string]$BinPath
    )
    New-Item -ItemType Directory -Path $BinPath -Force | Out-Null
    foreach ($name in @('DshNapCat.Setup.psm1', 'start-dsh-qq-bot.ps1', 'open-napcat-manager.ps1')) {
        Copy-Item -LiteralPath (Join-Path $SourceDirectory $name) -Destination (Join-Path $BinPath $name) -Force
    }
}

function Write-DshNapCatState {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$State, [Parameter(Mandatory = $true)][string]$Path)
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    $json = $State | ConvertTo-Json -Depth 16
    [System.IO.File]::WriteAllText($Path, ($json + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
}

function Read-DshNapCatState {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { throw "Setup state not found: $Path" }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Get-WslDistributions {
    $raw = & wsl.exe --list --quiet 2>$null
    return @($raw | ForEach-Object { ([string]$_).Replace([char]0, '').Trim() } | Where-Object { $_ })
}

function Ensure-WslDistribution {
    [CmdletBinding()]
    param([string]$Distro = 'Ubuntu-24.04')
    if (@(Get-WslDistributions) -notcontains $Distro) {
        & wsl.exe --install -d $Distro --no-launch
        if ($LASTEXITCODE -ne 0) { throw "WSL distribution installation failed for $Distro." }
    }
    & wsl.exe -d $Distro -u root -- true
    if ($LASTEXITCODE -ne 0) { throw "WSL distribution $Distro needs a Windows restart. Restart Windows, then rerun this installer." }
}

function Initialize-WslUser {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Distro, [Parameter(Mandatory = $true)][ValidatePattern('^[a-z_][a-z0-9_-]*$')][string]$LinuxUser)
    $script = @"
set -e
if ! id -u '$LinuxUser' >/dev/null 2>&1; then useradd -m -s /bin/bash '$LinuxUser'; fi
usermod -aG sudo '$LinuxUser'
printf '[user]\ndefault=$LinuxUser\n' > /etc/wsl.conf
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git build-essential
"@
    & wsl.exe -d $Distro -u root -- bash -lc $script
    if ($LASTEXITCODE -ne 0) { throw 'Failed to initialize the WSL user and base packages.' }
}

function New-WslBootstrapScript {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidatePattern('^[a-z_][a-z0-9_-]*$')][string]$LinuxUser,
        [string]$PluginRepository = 'https://github.com/riki-forsure/dsh-napcatqq-remote.git',
        [string]$RoutingRepository = 'github:yjh051108/dsh-routing-suite'
    )
    return @"
set -euo pipefail
export HOME='/home/$LinuxUser'
export NVM_DIR="`$HOME/.nvm"
if [ ! -s "`$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.6/install.sh | bash
fi
. "`$NVM_DIR/nvm.sh"
nvm install 24
nvm alias default 24
nvm use 24
corepack enable
corepack prepare pnpm@latest --activate
if ! command -v dsh >/dev/null 2>&1; then
  npm install --global @deepseek-ai/dsh@latest
fi
mkdir -p "`$HOME/dsh-work/main" "`$HOME/dsh-work/qq-channel-workspace"
if [ ! -f "`$HOME/.dsh/.agent-presets/router-standard/preset.yml" ]; then
  dsh plugin --profile web add '$RoutingRepository'
fi
repo="`$HOME/dsh-qq-channel"
if [ -d "`$repo/.git" ]; then
  git -C "`$repo" pull --ff-only
else
  git clone '$PluginRepository' "`$repo"
fi
cd "`$repo"
dsh_version="`$(dsh --version 2>/dev/null | head -n 1 || true)"
if ! node scripts/check-dsh-version.mjs "`$dsh_version"; then
  echo 'The installed DSH is older than the plugin compatibility floor; upgrading to the stable npm release.' >&2
  npm install --global @deepseek-ai/dsh@latest
  dsh_version="`$(dsh --version 2>/dev/null | head -n 1 || true)"
  node scripts/check-dsh-version.mjs "`$dsh_version"
fi
CI=1 pnpm install --frozen-lockfile
node --test
pnpm prune --prod --config.auto-install-peers=false
dsh plugin --profile web add "`$repo"
"@
}

function Invoke-WslBootstrap {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Distro,
        [Parameter(Mandatory = $true)][string]$LinuxUser,
        [string]$PluginRepository = 'https://github.com/riki-forsure/dsh-napcatqq-remote.git',
        [string]$RoutingRepository = 'github:yjh051108/dsh-routing-suite'
    )
    $script = New-WslBootstrapScript -LinuxUser $LinuxUser -PluginRepository $PluginRepository -RoutingRepository $RoutingRepository
    & wsl.exe -d $Distro -u $LinuxUser -- bash -lc $script
    if ($LASTEXITCODE -ne 0) { throw 'WSL DeepSeek Harness/plugin bootstrap failed.' }
}

function Get-WslHomeUncPath {
    param([Parameter(Mandatory = $true)][string]$Distro, [Parameter(Mandatory = $true)][string]$LinuxUser)
    return "\\wsl.localhost\$Distro\home\$LinuxUser"
}

function Merge-DshPluginConfig {
    [CmdletBinding()]
    param(
        $Existing,
        [Parameter(Mandatory = $true)][string[]]$AllowedContacts,
        [Parameter(Mandatory = $true)][string]$WebSocketUrl,
        [Parameter(Mandatory = $true)][string]$AccessToken,
        [string]$DefaultAgentPreset = 'router-standard'
    )
    $merged = [ordered]@{
        allowedContacts = @()
        websocketUrl = 'ws://127.0.0.1:3001'
        accessToken = ''
        stylePromptFile = ''
        emojiRoot = ''
        botSelfId = ''
        agentPreset = $DefaultAgentPreset
        fallbackAgentPresets = @('router-standard', 'standard', 'minimal')
        agentProvider = 'deepseek-official'
        agentModel = 'deepseek-v4-flash-vision-exp'
        agentReasoningEffort = 'max'
        maxAttachmentBytes = 52428800
        maxImageBytes = 20971520
        filePreviewBytes = 8192
    }
    if ($null -ne $Existing) {
        foreach ($property in $Existing.PSObject.Properties) { $merged[$property.Name] = $property.Value }
    }
    $merged.allowedContacts = @($AllowedContacts | ForEach-Object { [string]$_ })
    $merged.websocketUrl = $WebSocketUrl
    $merged.accessToken = $AccessToken
    return [pscustomobject]$merged
}

function Set-WslPluginConfig {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Distro,
        [Parameter(Mandatory = $true)][string]$LinuxUser,
        [Parameter(Mandatory = $true)][string[]]$AllowedContacts,
        [Parameter(Mandatory = $true)][string]$WebSocketUrl,
        [Parameter(Mandatory = $true)][string]$AccessToken,
        [string]$AgentPreset = 'router-standard'
    )
    $home = Get-WslHomeUncPath -Distro $Distro -LinuxUser $LinuxUser
    $directory = Join-Path $home '.dsh\qq-channel'
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $path = Join-Path $directory 'config.json'
    $existing = $null
    if (Test-Path -LiteralPath $path) { $existing = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json }
    $config = Merge-DshPluginConfig -Existing $existing -AllowedContacts $AllowedContacts -WebSocketUrl $WebSocketUrl -AccessToken $AccessToken -DefaultAgentPreset $AgentPreset
    $json = $config | ConvertTo-Json -Depth 16
    if ($null -ne $existing -and ($existing | ConvertTo-Json -Depth 16) -eq $json) {
        return [pscustomobject]@{ Path = $path; BackupPath = $null; Changed = $false }
    }
    $backup = Backup-FileIfPresent -Path $path
    [System.IO.File]::WriteAllText($path, ($json + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
    return [pscustomobject]@{ Path = $path; BackupPath = $backup; Changed = $true }
}

function Get-NapCatBotAccount {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Installation)
    if ($Installation.Kind -eq 'Shell') {
        $configDirectory = Join-Path $Installation.Root 'config'
        $webUiPath = Join-Path $configDirectory 'webui.json'
        if (Test-Path -LiteralPath $webUiPath) {
            try {
                $webUi = Get-Content -LiteralPath $webUiPath -Raw | ConvertFrom-Json
                $account = [string]$webUi.autoLoginAccount
                if ($account -match '^\d+$') { return $account }
            } catch {}
        }
        foreach ($file in @(Get-ChildItem -LiteralPath $configDirectory -Filter 'onebot11_*.json' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
            if ($file.BaseName -match '^onebot11_(\d+)$') { return $Matches[1] }
        }
    }
    return $null
}

function Get-NapCatWebUiPort {
    param([Parameter(Mandatory = $true)]$Installation)
    if ($Installation.Kind -eq 'Shell') {
        $path = Join-Path $Installation.Root 'config\webui.json'
        if (Test-Path -LiteralPath $path) {
            try {
                $config = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
                $port = [int]$config.port
                if ($port -gt 0 -and $port -lt 65536) { return $port }
            } catch {}
        }
    }
    return 6099
}

function Start-NapCatInstallation {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Installation, [string]$BotQQ)
    if (@(Get-Process -Name 'NapCatWinBootMain', 'NapCatQQ', 'NapCatQQ Desktop', 'NapCatQQ-Desktop' -ErrorAction SilentlyContinue).Count -gt 0) { return }
    if ($Installation.Kind -eq 'Shell' -and [System.IO.Path]::GetExtension($Installation.Launcher) -eq '.bat') {
        if ($BotQQ) {
            Start-Process -FilePath $Installation.Launcher -ArgumentList @($BotQQ) -WorkingDirectory $Installation.Root -WindowStyle Hidden
        } else {
            Start-Process -FilePath $Installation.Launcher -WorkingDirectory $Installation.Root -WindowStyle Hidden
        }
    } else {
        Start-Process -FilePath $Installation.ManagerExecutable -WorkingDirectory $Installation.Root -WindowStyle Hidden
    }
}

function Restart-NapCatInstallation {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)]$Installation, [string]$BotQQ)
    $root = [System.IO.Path]::GetFullPath([string]$Installation.Root).TrimEnd('\') + '\'
    foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
        $path = [string]$process.ExecutablePath
        if ($path -and [System.IO.Path]::GetFullPath($path).StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
            Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Milliseconds 500
    Start-NapCatInstallation -Installation $Installation -BotQQ $BotQQ
}

function Get-WslWindowsHostAddress {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Distro, [Parameter(Mandatory = $true)][string]$LinuxUser)
    $value = & wsl.exe -d $Distro -u $LinuxUser -- bash -lc "ip route show default | awk '{print `$3; exit}'"
    $hostAddress = ([string]($value | Select-Object -First 1)).Trim()
    if ($hostAddress -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { return '127.0.0.1' }
    return $hostAddress
}

function Complete-DshNapCatSetup {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$StatePath)
    $state = Read-DshNapCatState -Path $StatePath
    $installation = Get-NapCatInstallation -CandidatePaths @([string]$state.NapCatRoot) -IncludeDefaultCandidates $false
    if ($null -eq $installation) { throw 'NapCat installation is no longer available. Rerun install-full-stack.ps1.' }
    $botQQ = [string]$state.BotQQ
    if (-not $botQQ) { $botQQ = Get-NapCatBotAccount -Installation $installation }
    if (-not $botQQ) { return $false }
    $token = Unprotect-SetupSecret -CipherText ([string]$state.EncryptedAccessToken)
    $windowsHost = Get-WslWindowsHostAddress -Distro ([string]$state.Distro) -LinuxUser ([string]$state.LinuxUser)
    $napCatChanged = $false
    if ($installation.Kind -eq 'Shell') {
        $napCatResult = Set-NapCatOneBotConfig -ShellRoot $installation.Root -BotQQ $botQQ -AccessToken $token -HostName $windowsHost -Port 3001
        $napCatChanged = [bool]$napCatResult.Changed
    }
    $webSocketUrl = "ws://${windowsHost}:3001"
    Set-WslPluginConfig -Distro ([string]$state.Distro) -LinuxUser ([string]$state.LinuxUser) -AllowedContacts @($state.AllowedContacts) -WebSocketUrl $webSocketUrl -AccessToken $token -AgentPreset 'router-standard' | Out-Null
    Set-ObjectProperty -InputObject $state -Name 'BotQQ' -Value $botQQ
    Set-ObjectProperty -InputObject $state -Name 'NapCatRestartRequired' -Value $napCatChanged
    Set-ObjectProperty -InputObject $state -Name 'ConfiguredAt' -Value ([DateTime]::UtcNow.ToString('o'))
    Write-DshNapCatState -State $state -Path $StatePath
    return $true
}

function Test-LocalTcpPort {
    param([int]$Port)
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $result = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        $connected = $result.AsyncWaitHandle.WaitOne(500)
        if ($connected) { $client.EndConnect($result) }
        $client.Close()
        return $connected
    } catch { return $false }
}

function Start-DshWebIfNeeded {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Distro, [Parameter(Mandatory = $true)][string]$LinuxUser)
    if (Test-LocalTcpPort -Port 3080) { return $false }
    $command = 'cd "$HOME/dsh-work/main" && mkdir -p "$HOME/.dsh/logs" && nohup dsh web --host 127.0.0.1 --port 3080 > "$HOME/.dsh/logs/web.log" 2>&1 &'
    Start-Process -FilePath 'wsl.exe' -ArgumentList @('-d', $Distro, '-u', $LinuxUser, '--', 'bash', '-lc', $command) -WindowStyle Hidden
    return $true
}

Export-ModuleMember -Function @(
    'Get-NapCatInstallation',
    'Get-LatestNapCatOneKeyAsset',
    'Install-NapCatShell',
    'New-OneBotWebSocketServer',
    'Set-NapCatOneBotConfig',
    'Protect-SetupSecret',
    'Unprotect-SetupSecret',
    'New-RandomAccessToken',
    'Get-DshNapCatShortcutDefinitions',
    'Install-DshNapCatShortcuts',
    'Install-DshNapCatLauncherFiles',
    'Write-DshNapCatState',
    'Read-DshNapCatState',
    'Ensure-WslDistribution',
    'Initialize-WslUser',
    'New-WslBootstrapScript',
    'Invoke-WslBootstrap',
    'Merge-DshPluginConfig',
    'Set-WslPluginConfig',
    'Get-NapCatBotAccount',
    'Get-NapCatWebUiPort',
    'Start-NapCatInstallation',
    'Restart-NapCatInstallation',
    'Complete-DshNapCatSetup',
    'Test-LocalTcpPort',
    'Start-DshWebIfNeeded'
)
