# 仓库指南

## 项目结构与模块组织

前端项目位于 `app/`，Node/SQLite 后端位于同级的 `server/`，所有开发命令仍在 `app/` 目录执行。Vue 3 客户端位于 `app/src/`：`views/` 定义路由页面，`components/` 存放 UI 组件，`composables/` 封装可复用逻辑，`stores/` 管理 Pinia 状态，`services/` 调用 API，`types/`、`utils/` 和 `data/` 存放共享类型、工具及数据。静态文件放在 `app/public/`，需导入的样式和图标放在 `app/src/assets/`。后端默认数据库保留在 `app/data/football.sqlite`，生产静态资源读取 `app/dist/`，路径均不依赖启动目录。Playwright 场景位于 `app/tests/`，服务端集成测试以 `*.test.mjs` 命名并与服务端代码同目录。产品规格和已归档设计记录维护在 `openspec/`。

## 构建、测试与开发命令

请使用 Node.js 22.13 或更高版本。

```sh
cd app
npm ci                   # 按 package-lock.json 安装依赖
npm run dev              # 启动 Vite（15173）和 API（13001）
npm run build            # 执行类型检查并生成 app/dist
npm run test:server      # 运行 Node/SQLite 集成测试
npm run test:e2e         # 使用隔离端口和数据运行 Playwright 测试
npm run lint-format      # 使用 ESLint 和 Prettier 修复格式
```

首次运行浏览器测试前执行 `npx playwright install chromium`。需要单独调试时，使用 `npm run dev:client` 或 `npm run dev:server`。

根目录 `Makefile` 提供后台服务管理：`make start`、`make stop`、`make restart`、`make status`、`make logs`，各操作支持 `-frontend` / `-backend` 后缀。`make help` 显示中文帮助。使用 `FRONTEND_PORT`、`BACKEND_PORT` 指定端口；运行记录和日志位于 `app/.run/`。服务管理脚本位于 `app/scripts/services.mjs`，`make test-services` 使用临时数据库验证真实进程启停和代理连接。

## 编码风格与命名约定

遵循现有 TypeScript 和 Vue Composition API 模式。Prettier 规定两空格缩进、使用分号、ES5 尾随逗号及每行最多 120 个字符；ESLint 基于 Airbnb、Vue Essential 和 TypeScript 规则。Vue 组件使用 PascalCase（如 `RosterPanel.vue`），组合式函数以 `use` 开头（如 `useFormation.ts`），Pinia 模块命名为 `*Store.ts`，普通模块使用 camelCase。从 `src/` 导入时优先使用 `@/` 别名。

## 测试指南

浏览器测试命名为 `*.spec.ts`，后端测试命名为 `*.test.mjs`。涉及用户流程、持久化、数据校验或 API 的变更必须补充测试。Playwright 会创建临时 SQLite 数据库和独立浏览器会话，不得让测试使用 `app/data/football.sqlite`。提交前应运行相关测试套件及 `npm run build`。

## 提交与合并请求规范

历史提交主要采用简短的 Conventional Commit 标题，例如 `feat: ...` 和 `fix: ...`；回退提交使用 `Revert "..."`。每个提交应聚焦单一变更。合并请求需说明行为变化和验证方式，关联对应 Issue 或 OpenSpec 变更；视觉或响应式 UI 改动需附截图。数据库结构、API、PWA 或配置受到影响时必须明确说明。禁止提交 SQLite 文件、`dist/`、测试结果或密钥。

## Agent 专用说明

存在 `.codegraph/` 时，应先使用 `codegraph explore` 或 `codegraph node` 理解符号和调用路径，再进行大范围文本搜索。保留工作区中与当前任务无关的改动。
