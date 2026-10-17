# 参与贡献

感谢你愿意改进 AI 记忆库。这个项目的目标很小也很明确：**一个没有依赖、能双击打开、数据完全留在本地的记忆工具**。任何让体积暴涨、引入运行时依赖、或把数据发到服务器的改动都不会被接受。

## 开发环境

只需要 Node.js ≥ 18（自带 `fetch` 与全局 `WebSocket`）。**不需要 `npm install`**，本项目运行时和开发时都是零依赖。

```bash
npm run build     # src/ → dist/（单文件 HTML）
npm run dev       # 起本地静态服务器（http://127.0.0.1:8777）预览 src/
npm test          # 单元测试（node --test）
npm run test:e2e  # 真实浏览器端到端测试（系统 Edge / Chrome + CDP）
npm run test:file # 用 file:// 打开产物，验证「双击即用」
npm run check     # 静态自检：语法、DOM id 交叉引用、产物完整性
npm run verify    # 上面全部跑一遍
```

E2E 找不到浏览器时会跳过（退出码 0）；设置 `BROWSER_PATH=/path/to/chrome` 指定浏览器，或 `REQUIRE_BROWSER=1` 让缺失浏览器变成失败。

## 代码结构

```
src/index.html          唯一页面骨架，含 <!-- build:css --> / <!-- build:js --> 内联标记
src/styles.css          全部样式
src/js/util.js          通用小工具（转义、id、时间、下载、剪贴板）
src/js/parser.js        纯文本 → 结构化记忆（标签解析、对话切分）
src/js/store.js         记忆数据层（规范化、筛选排序、统计、导入合并、导出结构）
src/js/snapshot.js      上下文快照 Markdown 生成
src/js/filestore.js     localStorage / IndexedDB / File System Access 持久化
src/js/ui.js            渲染与事件绑定
src/js/main.js          入口
scripts/build.mjs       零依赖打包：按 MODULE_ORDER 拼接并去掉 import/export
scripts/check.mjs       静态自检
scripts/serve.mjs       极简静态服务器
scripts/shots.mjs       生成 README 截图
tests/unit.test.mjs     单元测试
tests/e2e.mjs           浏览器端到端测试
tests/file-protocol.mjs file:// 双击可用性测试
tests/lib/browser.mjs   CDP 驱动封装
```

## 加一个新模块的步骤

1. 在 `src/js/` 新建文件，只从已排序在前的模块 import；
2. 把它加进 `scripts/build.mjs` 的 `MODULE_ORDER`（顺序 = 依赖顺序）；
3. 在 `scripts/check.mjs` 不需要额外登记，它会自动发现新文件并做语法校验。

内联打包的约束只有两条，违反会在构建时报错而不是产出坏文件：

- `import` 必须单行，且只写 `import { a, b } from './x.js';`
- 导出只用 `export function` / `export const`，不要 `export default`，不要动态 `import()`

## 代码风格

- 源码用 ES5 风格的 `var` / `function`（浏览器兼容面最广），构建产物不做压缩，保持可读可审计
- 缩进 2 空格、LF 换行、UTF-8，见 `.editorconfig` 与 `.gitattributes`
- 用户输入进 `innerHTML` 前必须经过 `escapeHtml()`；新增任何拼接 HTML 的地方都要过一遍这条
- 新增逻辑请同时补测试：纯函数放 `tests/unit.test.mjs`，涉及 DOM 的放 `tests/e2e.mjs`

## 提交与 PR

- 提交信息用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：`feat:` / `fix:` / `docs:` / `test:` / `refactor:` / `chore:`
- PR 前请本地跑通 `npm run verify`
- 描述里写清楚「改了什么、为什么、怎么验证的」；UI 改动请附截图

## 报告问题

请附上：浏览器与版本、操作系统、复现步骤、期望行为与实际行为。如果涉及数据，**不要粘贴真实记忆内容**，用脱敏示例复现即可。
