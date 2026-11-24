# Antigravity 快速新建项目补丁（Antigravity Quick Project）

基于 [LOUIS798000/antigravity-chinese](https://github.com/LOUIS798000/antigravity-chinese) 的非侵入式 CDP 动态注入与静默守护架构实现，为新版 Google Antigravity 桌面客户端找回**一键快速新建项目（Quick / Scratch Project）**功能，免去每次手动新建文件夹和起名的麻烦。

## 功能特性

- **调用客户端原生能力**：通过 React Fiber 动态定位 Antigravity 底层保留的原生快速项目创建逻辑（`createScratchProjectFolder`），自动生成不冲突的随机项目名、在 `playground` 目录下创建项目文件夹、注册项目并直接进入新对话，不依赖混淆函数名，具备跨版本抗升级能力。
- **三种便捷触发方式**：
  1. **左侧边栏按钮**：在左侧边栏「项目」标题行最右侧（紧邻原有「创建新项目」图标）新增闪电图标按钮，尺寸与交互和原生按钮一致。
  2. **新建对话「选择项目」下拉菜单**：在输入框左上角的项目选择菜单中，紧跟「新建项目」下方自动插入「快速新建项目」选项，样式、对齐与高亮行为与原生菜单项一致。
  3. **全局快捷键**：按下 `Alt + Shift + N` 随时一键创建快速项目（侧边栏折叠时同样可用）。
- **原生主题自适应**：悬浮提示与底部状态提示采用与 Antigravity 原生弹层一致的磨砂卡片样式，自动适配浅色与深色主题。
- **完全非侵入、与汉化补丁零冲突**：不修改 `Antigravity.exe` 或 `app.asar`；独立进程名、独立 VBS 守护脚本名与独立开机自启项（`AntigravityQuickProjectPatch`），可与 `antigravity-chinese` 完美共存，升级或卸载互不影响。
- **轻量常驻与自动热更新**：纯原生 Node.js 零第三方依赖，内存堆上限限制为 48 MB；修改补丁脚本后后台守护进程会在数秒内自动热重载并通过源码内容指纹完成增量覆盖。

## 环境要求

- Windows 10 / 11
- [Node.js](https://nodejs.org/) 18 或更高版本
- Google Antigravity 桌面客户端

## 快速安装（Windows）

在 PowerShell 中克隆仓库并运行安装脚本：

```powershell
git clone https://github.com/LOUIS798000/antigravity-quick-project.git
cd antigravity-quick-project\win
.\install.ps1
```

安装脚本会自动完成以下配置：
1. 检测并记录本机 Node.js 路径；
2. 配置 Windows 当前用户开机自启（`HKCU\Run\AntigravityQuickProjectPatch`）；
3. 自动为桌面、开始菜单及任务栏的 Antigravity 快捷方式补充 `--remote-debugging-port=0` 启动参数（适配 Antigravity v2.33+）；
4. 启动无窗口后台静默守护进程，并对当前已打开的 Antigravity 客户端执行首次即时注入。

> 提示：如果安装前已打开的 Antigravity 客户端未携带 `--remote-debugging-port=0` 参数，重启一次客户端即可自动生效。

## 卸载方式

在 PowerShell 中运行卸载脚本即可彻底清理自启项与后台守护进程：

```powershell
cd antigravity-quick-project\win
.\uninstall.ps1
```

## 目录结构

```text
antigravity-quick-project/
├── LICENSE                                      # MIT 开源协议
├── README.md                                    # 项目说明文档
└── win/
    ├── install.ps1                              # Windows 一键安装与开机自启配置脚本
    ├── uninstall.ps1                            # Windows 一键卸载脚本
    ├── start-quick-project-silent.vbs           # 无黑框常驻守护启动器
    └── bin/
        └── antigravity-quick-project-patch.js   # 核心 CDP 动态注入与前端 UI 补丁
```

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。
