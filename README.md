# Sticky Notes

基于 Tauri 2、Rust 和 TypeScript 的轻量桌面便签与待办工具。界面使用系统 WebView 渲染，窗口、托盘、本地存储和屏幕交互由 Rust 主进程管理。

## 功能

### 便签

- 支持同时创建和管理多个独立便签窗口
- 正文输入后自动保存，隐藏或退出应用前会刷新待保存内容
- 双击编辑便签标题，并同步更新窗口标题和托盘便签列表
- 单独置顶或取消置顶任意便签
- 单独隐藏到托盘或永久删除当前便签
- 删除最后一个便签后应用继续驻留托盘，可随时新建便签

### 待办

- 每个便签可独立切换便签模式和待办模式
- 待办列表为空时切换模式，可选择按回车将现有正文复制为待办，原正文保持不变
- 支持新增、编辑、删除和完成待办
- 已完成待办自动进入归档，支持恢复、单独删除和清空归档
- 待办模式、未完成列表和归档列表均持久化保存

### 窗口

- 无边框窗口，可拖动标题栏移动
- 通过系统原生窗口接口拖动四条边和四个角调整尺寸
- 记忆每个便签的位置、尺寸、置顶状态和吸附状态
- 新建便签默认垂直居中并距屏幕右侧 50px；有副屏时优先放到副屏，无副屏时使用主屏
- 支持混合 DPI 与多显示器工作区识别，避免窗口尺寸异常或意外完全移出可见区域
- 靠近屏幕外边缘时自动吸附并收缩，保留可见触发条；鼠标移入自动展开，移出后快速收起
- 吸附、收缩和展开带平滑动画，屏幕之间的内部边界不会误触发外边缘吸附
- Windows 下通过原生工作区 API 排除任务栏区域
- 禁用窗口最大化能力，避免顶部吸附触发 Windows 分屏，同时保留边缘缩放
- 便签窗口不占用任务栏，只通过桌面窗口和系统托盘管理

### 系统托盘

- 托盘菜单使用应用图标，并按便签真实标题展示窗口列表
- 支持新建便签、打开指定便签、显示全部和隐藏全部
- 窗口关闭只影响当前便签，退出整个应用仅保留在托盘菜单
- 托盘退出时通知所有便签完成正文保存，再持久化窗口位置
- 托盘菜单根据系统语言显示中文或英文

### 本地存储

- 正文、标题、待办、归档、模式、置顶状态和窗口布局统一保存为版本化 JSON
- 写入时使用临时文件和备份替换，损坏时自动备份原文件并恢复可用状态
- 完整兼容 Electrobun 版本已有的 `notes.json`，升级技术栈不会丢失数据
- 支持首次启动时导入旧版 `note.txt` 正文

## 技术架构

```text
src/
├── mainview/        # HTML、CSS 和 TypeScript 界面
└── shared/          # 前端数据与命令类型
src-tauri/
├── capabilities/    # Tauri 窗口权限
└── src/
    ├── commands.rs  # 前端命令入口
    ├── repository.rs # JSON 数据仓库
    ├── windows.rs   # 多窗口、吸附、缩放和应用生命周期
    ├── platform.rs  # 平台工作区适配
    └── tray.rs      # 系统托盘及菜单
```

## 技术栈对比

以下体积来自本项目 Windows x64 Release 产物；Wails 没有对应的正式发布包，因此仅保留架构层面对比，不用估算值冒充实测数据。

| 项目 | Tauri 2（当前） | Electrobun（旧版） | Wails 3 |
| --- | --- | --- | --- |
| 主进程 | Rust 原生二进制 | Bun 运行时 + TypeScript | Go 原生二进制 |
| 界面运行时 | 系统 WebView2 | 系统 WebView | 系统 WebView2 |
| Windows 安装包 | NSIS 2.12 MiB；MSI 3.08 MiB | EXE 29.05 MiB（v1.1.1） | 本项目未发布实测包 |
| 未压缩主程序 | 8.79 MiB | 未单独统计 | 未实测 |
| 启动与常驻开销 | Rust 主进程开销低；主要内存来自 WebView2 和窗口数量 | 额外常驻 Bun 运行时 | Go 运行时与 GC 有少量基础开销；主要内存同样来自 WebView2 |
| 原生窗口能力 | 可直接使用 Rust crate 和 Windows API，适合吸附、托盘及多窗口状态机 | 通过 TypeScript/原生桥接扩展 | 通过 Go 与平台 API 扩展，开发门槛较低 |
| 构建复杂度 | Rust 首次编译较慢，Windows 打包依赖 NSIS/WiX | 前端团队上手最快，打包体积较大 | Go 编译和跨平台打包相对直接 |
| 跨平台 | Windows、macOS、Linux，并支持移动端 | Windows、macOS、Linux | Windows、macOS、Linux |

当前 Tauri 2 NSIS 安装包比旧版 Electrobun 安装包缩小约 92.7%。这里没有把启动时间或内存写成绝对数值，因为未在相同机器、相同窗口数量下做统一基准；实际占用通常由 WebView2 页面和打开的便签窗口数量主导。

生产数据保存在应用本地数据目录：

```text
%LOCALAPPDATA%\com.stickynotes.desktop\stable\notes.json
```

开发环境使用同目录下的 `dev/notes.json`，不会覆盖生产数据。首次启动新版本时会自动发现并迁移旧版 Sticky Notes 数据文件。

## 下载与安装

当前 Release 提供 Windows x64 安装包：

- `setup.exe`：推荐普通用户使用，按向导安装到当前用户目录
- `.msi`：适合需要 Windows Installer 部署的场景

安装后直接从开始菜单启动，应用不会弹出终端窗口。程序未购买商业代码签名证书时，Windows SmartScreen 仍可能显示来源提醒。

## 开发环境

- Node.js 20 或更高版本
- Rust stable 工具链
- Windows：Microsoft C++ Build Tools 与 WebView2 Runtime
- macOS：Xcode Command Line Tools

安装依赖并启动：

```bash
npm install
npm run dev
```

前端类型检查：

```bash
npm run typecheck
```

## 构建

构建当前平台安装包：

```bash
npm run build
```

Windows 同时生成 NSIS EXE 和 WiX MSI 安装包：

```bash
npm run package:win
```

输出目录：

```text
src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/
src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/
```

Tauri 直接生成 GUI 程序和系统安装包，不再携带 Bun 运行时，也不再需要 ZIP、Inno Setup 或启动终端脚本。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+Alt+N` | 新建便签 |
| `Ctrl+Alt+T` | 切换便签/待办模式 |
| `Esc` | 关闭弹窗、退出待办模式或隐藏窗口 |

## 许可证

MIT
