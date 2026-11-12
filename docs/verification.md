# 验证记录

## 已在开发环境通过

- 干净目录 `npm ci`，Node.js 24。
- `npm run build`：Vue 类型检查、Vite 生产构建。
- `npm run test:unit`：7 项，包含球员数据/阵型分配与测试数据库隔离。
- `npm run test:server`：23 项，包含原战术持久化/迁移/版本和俱乐部认证、CSRF、角色/球队边界、报名、统计、空值、跨年日期、密码重置、重启、冲突、比分一致性。
- `node scripts/services.test.mjs`：1 项，真实前后端进程、代理和端口冲突。
- `npm run test:bundle`：符合现有 JS/CSS 体积预算。
- 新增俱乐部视图、API 和认证模块 ESLint 无错误；未声称整个旧仓库已经消除所有历史 lint 问题。
- SQLite 在线备份与备份 integrity_check、原数据读取核对。
- `npm audit --omit=dev`：0 已知告警；开发工具链仍有继承的间接依赖告警，见部署文档。

## 浏览器与部署限制

Playwright 已发现 72 个场景，包括新增的管理员完整流程、球员报名权限、慢请求离开战术板后重新加载。此执行环境的 Chromium 在创建 socket 时被阻止；可用云浏览器与执行主机隔离，访问临时服务器返回连接拒绝，因此**尚未在这里执行完成浏览器回归或视觉验收**。

GitHub Actions 配置运行完整浏览器套件、Docker 镜像构建和容器登录烟雾测试；请以当前提交的实际 Actions 结果为准，不把“有测试代码”当作“测试通过”。没有对用户生产服务器做部署。Docker 配置已准备，但当前环境未提供 Docker 引擎，未实测镜像构建。

## 测试数据安全

Playwright 限定单 worker，配置创建带所有权标记的系统临时 `football-playwright-*` 目录，向测试进程传递测试专用路径。每个场景先清空该临时库的俱乐部记录，再使用真实管理员登录。路径、文件名、标记和符号链接检查拒绝非测试数据库。服务退出清理其临时目录；不会继承用户的业务 FOOTBALL_DB_PATH 来运行浏览器测试。
