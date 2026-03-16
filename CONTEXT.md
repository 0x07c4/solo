# Solo 上下文与计划

最后更新：2026-03-17

## 1. 当前目标

做一个 Linux 桌面客户端：

- 可直接在应用内对话（优先 ChatGPT 账号登录态）
- 可选挂载本地工作区做代码上下文
- 保留后续扩展为“代理执行/提案审批”的能力

## 2. 已落地决策

1. **对话通道优先 `codex_cli`**
   - 不再依赖用户单独充值 API key 才能聊天。
   - 启动时会把 provider 调整到 `codex_cli`。

2. **支持纯对话模式（无工作区）**
   - 不挂载文件夹也可直接聊天。
   - 只有需要代码上下文时才绑定工作区。

3. **界面方向参考 ChatGPT + Copilot**
   - 左侧：会话 + 工作区
   - 中间：主对话
   - 右侧：上下文/文件预览

4. **“生成中”状态放在消息区，不放输入区**
   - 输入区只保留输入提示。

5. **UI 设计语言改为 ChatGPT + AstroNvim/LazyVim**
   - 交互形态继续以对话为主，不做成伪编辑器。
   - 视觉系统借 editor chrome、紧凑信息密度和 pane 语言。

6. **字体策略固定为“UI 无衬线 + Maple Mono NF CN”**
   - 正文、按钮、标题仍以无衬线为主。
   - 路径、文件树、状态栏、badge、过程日志、预览区使用 `Maple Mono NF CN`。

7. **布局模式改为自适应**
   - 无工作区绑定时进入纯对话模式（弱化 workbench）。
   - 当前会话绑定工作区后进入 workbench 模式（三栏）。

8. **继续吸收 Zed 的 UI 优点，但不做成编辑器**
   - 顶部 chrome 更薄、更像开发工具状态条。
   - 左侧栏更高密度，减少大卡片感，增强 pane/list 语言。
   - 目标是“开发工具感”，不是“网页控制台感”。

9. **主页面固定一屏，不使用浏览器级滚动**
   - 整个应用视口固定在 100vh。
   - 只允许聊天区、文件树、右侧面板等内部区域各自滚动。

10. **移除系统白色标题栏，改为应用内自绘窗口 chrome**
   - Tauri 窗口禁用原生 decorations。
   - 顶部使用深色标题栏、拖拽区、自绘最小化/最大化/关闭按钮。

11. **Git 历史只保留公开身份**
   - 仓库历史重写为单个 `Solo` 初始化提交。
   - 提交身份统一使用 GitHub `noreply`：`0x07c4 <0x07c4@users.noreply.github.com>`。
   - 不保留任何带个人邮箱、本地绝对路径或旧品牌历史的公开提交链。

## 3. 当前实现快照

- 前端：React + Vite（`src/App.jsx`, `src/App.css`）
- 后端：Tauri Rust（`src-tauri/src/lib.rs`）
- 数据：本地持久化 sessions/workspaces/settings（`src-tauri/src/storage.rs`）
- 登录检测：`codex login status`
- 对话执行：`codex exec`（`codex_cli` 模式）
- 主题：默认 `TokyoNight`，支持 Catppuccin / Gruvbox / Nord / One Dark / Dracula / Kanagawa
- 布局：按当前会话是否绑定工作区自动切换 `chat / workbench`
- 字体：关键开发工具区域使用 `Maple Mono NF CN`
- Chrome：顶部与侧栏已开始向 Zed 式紧凑 pane 风格收敛
- Window：已切换为自绘深色标题栏，避免 Linux 默认白色系统栏破坏主题
- Git：仓库历史将收敛为公开可推送的单提交初始化状态

## 4. 近期计划（按优先级）

### P0（先做）

- [x] 增加明确的“纯对话模式”开关（隐藏/折叠工作区面板）
- [ ] 在 UI 显示“当前模型提示”（从本机 codex 配置读取）
- [x] 优化回答风格约束，减少模板化回复
- [x] 增加对话失败的可读错误提示（网络/登录态/命令失败区分）
- [x] 建立 `Workbench Dark` 视觉方向，默认 TokyoNight
- [x] 落地 `Maple Mono NF CN` 到关键开发工具区域
- [x] 吸收 Zed 的薄 chrome / 高密度侧栏优点
- [x] 移除系统白标题栏，接管窗口顶部 chrome
- [x] 清理公开 Git 历史中的个人身份与旧品牌残留

### P1（随后）

- [ ] 把主题变量继续整理成更稳定的 semantic/component token 结构
- [ ] 继续压缩顶栏与侧栏 chrome，减少 web 卡片感
- [ ] 对话消息支持 Markdown 渲染
- [ ] 会话搜索与固定
- [ ] 支持导出会话
- [ ] 完善移动端/窄窗口布局

### P2（后续扩展）

- [ ] 恢复/重构“提案审批（写文件/跑命令）”工作流入口
- [ ] 增加更细粒度的权限策略与审计日志

## 5. 本地开发与验证

```bash
npm install
npm run tauri dev
```

提交前至少执行：

```bash
npm run lint
npm run build
cd src-tauri && cargo check
```

## 6. 更新规则

后续每次较大改动后，更新本文件：

1. “已落地决策”
2. “当前实现快照”
3. “近期计划”的勾选状态
