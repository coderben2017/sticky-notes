# 桌面便签 (Desktop Sticky Notes)

基于 **Wails v2** 开发的轻量级、无边框桌面便签工具，旨在提供极简、流畅且原生感十足的记录体验。

## ✨ 功能清单

| 功能名称 | 功能说明 | 状态 |
| --- | --- | :---: |
| **多实例运行** | 支持同时新建和管理多个便签，每个便签进程独立互不干扰 | ✅ |
| **窗口置顶** | 提供一键固定置顶功能，保证便签随时可见，方便摘录对照 | ✅ |
| **自动保存** | 打字输入时（防抖处理）实时自动持久化保存到本地 | ✅ |
| **多屏兼容** | 智能识别多屏环境，优化便签启动时的默认展现位置 | ✅ |
| **系统托盘** | 完整的系统托盘支持，可选择隐藏到后台运行或彻底退出 | ✅ |
| **定制化交互** | 无边框拖拽移动支持，以及沉浸式的美观自定义确认对话框 | ✅ |
| **待办模式** | 支持待办列表展示，复选框可标记完成并自动归档到历史记录 | ✅ |
| **快捷键** | 窗口内快捷键支持（Ctrl+Alt+N 新建、Ctrl+Alt+H 隐藏、Ctrl+Alt+T 切换待办模式） | ✅ |
| **自定义标题** | 支持双击编辑便签标题，失焦时自动保存到本地 | ✅ |
| **现代化 UI** | 集成 Tailwind CSS，提升界面美观度与交互友好度 | ✅ |

## 🛠️ 技术栈

- **后端**：[Go](https://go.dev/) + [Wails v2](https://wails.io/)
- **前端**：HTML5 + CSS3 + Vanilla JavaScript（基于 [Vite](https://vitejs.dev/) 驱动）
- **样式框架**：[Tailwind CSS](https://tailwindcss.com/) + [PostCSS](https://postcss.org/)
- **托盘支持**：[systray](https://github.com/energye/systray)

## ⌨️ 快捷键

在应用窗口中可使用以下快捷键快速操作：

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+Alt+N` | 新建便签 |
| `Ctrl+Alt+H` | 隐藏到托盘 |
| `Ctrl+Alt+T` | 切换待办模式 |

## 💡 功能使用

### 待办模式
- 点击标题栏的 `☑` 按钮或按 `Ctrl+Alt+T` 切换到待办模式
- 在输入框中输入任务并按 Enter 或点击"添加"按钮
- 勾选任务复选框标记完成，完成的任务会自动移至"历史"区
- 可点击任务或历史项的"删除"按钮快速移除
- 点击"清空"按钮可清空所有历史记录

### 自定义标题
- 双击窗口标题栏中的标题文字即可编辑
- 编辑完成后点击其他位置或按 Tab 键，新标题会自动保存

### 粘贴板固定
- 点击标题栏的 `📌` 按钮可固定便签置顶
- 固定后按钮会变红，再点击可取消置顶

## 🚀 本地开发

确保你已经安装了 Go (>= 1.18) 和 Wails 命令行工具，并配置好了前端开发环境（Node.js / npm）。

```bash
# 启动实时热重载开发服务器
wails dev
```
前端的修改将会实时更新，后端的修改会在重新编译后自动重载应用。

## 📦 编译构建

你可以使用 Wails 提供的 build 命令将其打包为无依赖的单个可执行程序：

```bash
# 构建用于生产环境的单文件可执行程序
wails build
```

构建完成的程序会生成在 `build/bin/` 目录下。

## 🎨 Tailwind CSS 集成

项目已集成 Tailwind CSS 以改善UI美观度。相关配置文件包括：

- `frontend/postcss.config.cjs`：PostCSS 配置
- `frontend/tailwind.config.cjs`：Tailwind 配置（扫描 `frontend/` 中的所有文件）
- `frontend/src/style.css`：包含 Tailwind 指令（`@tailwind base`、`@tailwind components`、`@tailwind utilities`）

### 回滚 Tailwind（仅保留原生 CSS）

若要移除 Tailwind 并回滚到原生 CSS 版本：

```bash
# 1. 在 frontend 目录下移除 devDependencies
cd frontend
npm uninstall tailwindcss postcss autoprefixer

# 2. 删除 Tailwind 配置文件
rm postcss.config.cjs tailwind.config.cjs

# 3. 从 frontend/src/style.css 移除以下三行：
#    @tailwind base;
#    @tailwind components;
#    @tailwind utilities;

# 4. 清理 dist 目录并重新构建
rm -r dist
npm run build

# 5. 回到项目根目录并重新启动开发服务器
cd ..
wails dev
```

## 📝 许可证

MIT

