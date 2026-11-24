$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$ScriptPath = Join-Path $Root "bin\antigravity-quick-project-patch.js"
$VbsPath = Join-Path $Root "start-quick-project-silent.vbs"
$NodePathFile = Join-Path $Root "node_path.txt"
$TaskName = "AntigravityQuickProjectPatch"

# 1. 检查 Node.js 环境
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "[错误] 未找到 Node.js。请先安装 Node.js 18 或更高版本，然后重新运行 install.ps1。" -ForegroundColor Red
    exit 1
}

$nodeExePath = $node.Source
Set-Content -Path $NodePathFile -Value $nodeExePath -Encoding ASCII
Write-Host "已识别并配置 Node.js 路径: $nodeExePath" -ForegroundColor Green

# 2. 停止已有旧版快速项目守护进程（绝不误杀 antigravity-chinese 等其他补丁）
try {
    Get-CimInstance Win32_Process | Where-Object {
        $_.Name -match "^(node|wscript|cscript)(\.exe)?$" -and (
            $_.CommandLine -like "*antigravity-quick-project-patch.js*" -or
            $_.CommandLine -like "*start-quick-project-silent.vbs*"
        )
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
} catch {}

# 3. 配置 Windows 注册表开机自启 (HKCU\Run)
$RegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$WscriptExe = "$env:SystemRoot\System32\wscript.exe"
$RegValue = "`"$WscriptExe`" //B //Nologo `"$VbsPath`""
Set-ItemProperty -Path $RegPath -Name $TaskName -Value $RegValue -Force

$ApprovedPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
if (Test-Path $ApprovedPath) {
    Set-ItemProperty -Path $ApprovedPath -Name $TaskName -Value ([byte[]](0x02,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00)) -Force
}
Write-Host "已配置注册表开机自启动项 ($TaskName)。" -ForegroundColor Green

# 4. 适配 Antigravity v2.33+：确保快捷方式已带有 --remote-debugging-port=0
$patchedShortcuts = @()
try {
    $WshShell = New-Object -ComObject WScript.Shell
    $shortcutDirs = @(
        [Environment]::GetFolderPath("Desktop"),
        [Environment]::GetFolderPath("CommonDesktopDirectory"),
        [Environment]::GetFolderPath("Programs"),
        [Environment]::GetFolderPath("CommonPrograms"),
        (Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar")
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

    foreach ($dir in $shortcutDirs) {
        Get-ChildItem -Path $dir -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                $sc = $WshShell.CreateShortcut($_.FullName)
                if ($sc.TargetPath -and ($sc.TargetPath -match "(?i)\\Antigravity\.exe$")) {
                    $curArgs = [string]$sc.Arguments
                    if ($curArgs -notmatch "(?i)--remote-debugging-port") {
                        $sc.Arguments = if ([string]::IsNullOrWhiteSpace($curArgs)) { "--remote-debugging-port=0" } else { "--remote-debugging-port=0 $curArgs" }
                        $sc.Save()
                        $patchedShortcuts += $_.FullName
                    }
                }
            } catch {}
        }
    }
} catch {}

if ($patchedShortcuts.Count -gt 0) {
    Write-Host "已为以下快捷方式补充 --remote-debugging-port=0：" -ForegroundColor Green
    $patchedShortcuts | ForEach-Object { Write-Host "  - $_" -ForegroundColor Gray }
}

# 5. 立即脱壳拉起后台静默守护进程
try {
    Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = "`"$WscriptExe`" //B //Nologo `"$VbsPath`""
    } | Out-Null
} catch {
    Start-Process -FilePath $WscriptExe -ArgumentList "//B", "//Nologo", "`"$VbsPath`"" -WindowStyle Hidden
}

# 6. 执行首次即时注入
Write-Host "执行首次快速新建项目补丁注入..." -ForegroundColor Cyan
& "$nodeExePath" "$ScriptPath"

Start-Sleep -Milliseconds 1000
$daemon = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*antigravity-quick-project-patch.js*--watch*" } | Select-Object -First 1
if ($daemon) {
    Write-Host "后台守护进程已常驻运行 (PID: $($daemon.ProcessId))。" -ForegroundColor Green
}

# 7. 检测当前运行的 Antigravity 是否开启了 CDP 端口
$needRestartClient = $false
try {
    $mainProc = Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq "Antigravity.exe" -and $_.CommandLine -notmatch "--type=" -and $_.CommandLine -notmatch "--import="
    } | Select-Object -First 1
    if ($mainProc -and ($mainProc.CommandLine -notmatch "(?i)--remote-debugging-port")) {
        $needRestartClient = $true
    }
} catch {}

Write-Host "==========================================" -ForegroundColor Green
Write-Host "Antigravity 快速新建项目补丁已安装并生效！" -ForegroundColor Green
Write-Host "触发方式: 左侧「项目」闪电图标 / 新建对话项目下拉菜单 / 快捷键 Alt+Shift+N" -ForegroundColor Green
if ($needRestartClient) {
    Write-Host "[提示] 检测到当前 Antigravity 未携带 --remote-debugging-port=0，重启客户端后即可自动生效。" -ForegroundColor Yellow
}
Write-Host "==========================================" -ForegroundColor Green
