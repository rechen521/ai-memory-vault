# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] — 2026-10-16

首个开源版本。功能集与最初的单文件原型 `ai-memory-vault.html` 保持一致，但重新组织了源码结构、补上了测试与安全加固。

### Added
- 记忆录入：角色（用户 / AI）、标签、重要度（1–3 星），支持 `Ctrl / ⌘ + Enter` 与标签框回车快速保存
- 批量导入：粘贴整段对话，自动按 `用户：/ AI：/ User: / Assistant:` 等前缀切分入库，识别不到前缀时兜底存为单条并打 `批量导入` 标签
- 检索：全文搜索（内容 + 标签）、标签下拉筛选、标签 chip 点击筛选、三种排序（智能 / 最新 / 最早）
- 卡片操作：置顶、内联编辑、删除（带确认）；编辑草稿在筛选重绘时不会丢失
- 统计面板：总数、标签数、用户侧、AI 侧、高优先级条数、最后更新时间
- **上下文快照**：一键生成结构化 Markdown（含时间、星级、标签、置顶标记、筛选范围说明），可复制到剪贴板或下载 `.md`
- **双保险持久化**：`localStorage` 常驻 + File System Access API 绑定本地 JSON 文件自动落盘（去抖 400ms，页面隐藏时立即 flush）；另有 JSON 导入 / 导出
- 开场彩蛋弹窗：`May you one day be reunited with the people who matter most to you.`（每会话首次打开出现，统计面板右下角 `✦` 可重现）
- 无障碍：`role="dialog"` / `aria-modal`、`aria-pressed`、可见焦点环、`Esc` 关闭弹窗、图标按钮具备可读名称、`prefers-reduced-motion` 与打印样式
- 工程化：零依赖构建脚本 `scripts/build.mjs`（ES 模块 → 单文件 HTML）、静态自检 `scripts/check.mjs`、24 项单元测试、46 组真实浏览器 E2E 断言、GitHub Actions CI 与 Pages 部署

### Fixed
- **安全**：导入数据中的 `id` 会被直接拼进 HTML 属性与 CSS 选择器，构造恶意 id（如 `"><img src=x onerror=…>`）可造成属性注入型 XSS；现在所有 id 统一经 `sanitizeId()` 白名单净化，且渲染时二次转义
- 下载 `.md` 快照时 MIME 类型错误（此前固定为 `application/json`）
- `beforeunload` 中调用的去抖写入在页面卸载前根本不会执行，实际等于没有保存；改为 `visibilitychange → hidden` 时立即 flush
- 导入时对重复数据只按 `id` 去重，换过 id 的同一份备份会重复导入；现在按 `id` + 内容指纹双重去重，并回报「跳过若干条」
- 纯空白内容（如仅空格）会被当作有效记忆存入；`normalizeMemory` 现在统一 trim，空内容直接拒收
- 标签重复（`a,a`）会重复计数；标签现在按大小写不敏感去重
- 统计面板的标签数曾用 `tagSet.__count || …` 这种会在标签数为 0 时取到字符串的写法，已修正为显式计数
- 首页状态徽标改为 `<button>`，可键盘聚焦；绑定失败、授权被拒、写入失败均有明确文案

### Changed
- 源码从单个 821 行 HTML 拆分为 `src/index.html` + `src/styles.css` + `src/js/{util,parser,store,snapshot,filestore,ui,main}.js`，构建产物仍是单文件、零依赖、双击即用
- 批量导入、快照、导出等行为保持与原型一致；快照在筛选状态下会额外标注「已筛选：标签 #x + 关键词 y」，避免 AI 误以为拿到了全部记忆

[1.0.0]: https://github.com/rechen521/ai-memory-vault/releases/tag/v1.0.0
