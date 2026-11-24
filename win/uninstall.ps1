$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$TaskName = "AntigravityQuickProjectPatch"
$NodePathFile = Join-Path $Root "node_path.txt"

# 1. 移除注册表自启动项
$RegPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
if (Get-ItemProperty -Path $RegPath -Name $TaskName -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $RegPath -Name $TaskName -Force -ErrorAction SilentlyContinue
    Write-Host "已移除注册表自启动项 ($TaskName)。" -ForegroundColor Green
}

# 2. 停止快速项目后台守护进程（绝不误杀其他补丁）
try {
    Get-CimInstance Win32_Process | Where-Object {
        $_.Name -match "^(node|wscript|cscript)(\.exe)?$" -and (
            $_.CommandLine -like "*antigravity-quick-project-patch.js*" -or
            $_.CommandLine -like "*start-quick-project-silent.vbs*"
        )
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Write-Host "已停止快速新建项目后台守护进程。" -ForegroundColor Green
} catch {}

# 3. 清理临时配置文件
if (Test-Path $NodePathFile) {
    Remove-Item -Force $NodePathFile -ErrorAction SilentlyContinue
}

Write-Host "Antigravity 快速新建项目补丁已完全卸载（重启客户端或刷新页面后界面按钮将消失）。" -ForegroundColor Green
