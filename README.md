# 足球俱乐部管理

Vue 3 + Node.js + SQLite，面向业余俱乐部。保留原有战术板、阵型、动画、版本、导入导出与打印，新增管理端和球员端。

## 功能

- 管理员维护球队名称、队徽、球员姓名/号码/头像/位置/惯用脚/备注与入队状态；账号可后续绑定，离队归档保留历史。球员只读资料、操作本人报名、修改本人密码。
- 比赛草稿、发布、取消、完赛；赛事、对手、日期/时间、地点、人数制与主客场；参加 / 不参加 / 待定报名。
- 比赛名单、首发/替补、位置、独立确认的实际出场，以及比分、进球、助攻与复盘。未确定的首发、出场或统计保持未知。
- 任意起止日期赛季，可跨自然年；各赛季维护名单和号码。比赛显式选择所属赛季，重叠赛季不混算；自然年统计只依据比赛实际日期。
- 球队胜平负、进失球、对手交锋、出勤覆盖及个人报名/出场/进球/助攻统计。缺失数据不补零，报名不等于实际出场。
- 比赛战术和阵容资料保存独立快照，模板编辑/删除、旧版本清理和球员改名改号不改变既有比赛快照。旧记录只可按迁移时内容补录，并明确标记，不声称恢复未知的赛时状态。
- 保留原战术板、阵型、换人演示、画板、动画、战术版本、导入导出与打印。当前界面管理一支球队，数据与权限预留球队归属，不含多队切换。
- 独立 REST 后端为后续微信小程序复用保留边界；本次不含小程序、微信登录、财务、费用、训练签到或逐次换人事件系统。

## 用虚构数据本地试用

不需要配置真实账号或数据库。在 `app` 目录运行：

```sh
npm ci
npm run build
npm run demo
```

打开终端打印的本机地址，使用本次随机生成的管理员/球员账号。每次运行都创建隔离的新 SQLite，不读取或覆盖业务库；按 Ctrl+C 停止，打印的 `--resume` 命令可继续进度。包含虚构球员、跨年赛季、比赛/报名/比分、可编辑战术和历史快照。

完整安装、逐步操作、预期统计、备份恢复及自动核对见 [本地虚构数据与完整演练](docs/demo-rehearsal.md)。

## 本地开发

推荐 Node.js 24 LTS（最低 22.13）。在仓库根目录：

```sh
cd app
npm ci
# 仅首次创建管理员，密码至少 10 个字符。用交互输入避免写入命令历史。
read -r -s -p '初始管理员密码: ' FOOTBALL_ADMIN_PASSWORD; echo
export FOOTBALL_ADMIN_PASSWORD
FOOTBALL_ADMIN_USERNAME=owner npm run bootstrap-admin
unset FOOTBALL_ADMIN_PASSWORD
npm run dev
```

打开 http://127.0.0.1:15173 。后端默认 http://127.0.0.1:13001；SQLite 位于 `app/data/football.sqlite`。无需安装独立数据库。不提供公共注册或默认密码。首次管理员工具只在数据库无管理员时创建，不会改已有密码。

生产运行：`cd app && npm ci && npm run build && npm start`，同一个 Node 服务提供网页和 `/api`。请设置与实际访问地址一致的 `FOOTBALL_PUBLIC_ORIGIN`，并通过 HTTPS 反向代理对外开放。生产部署不依赖 Vite。

## 验证

```sh
cd app
npm run check
node scripts/services.test.mjs
npx playwright install chromium
npm run test:e2e
```

所有服务端与浏览器测试使用临时 SQLite，不使用业务数据库。`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium` 可使用本机 Chromium。CI 在每次代码推送运行同样的构建、服务端、容器与浏览器回归，PR 引用对应提交的检查结果。

## 升级和部署

先阅读 [部署与备份](docs/deployment.md)。现有 SQLite 会保留原表，新建 `club_*` 表并迁移已有名单 ID。禁止删除数据库、用测试库覆盖或在运行中只复制 SQLite 主文件。

API 见 [接口说明](docs/club-api.md)。旧战术 API 保持数据格式，但现在必须登录，写入仅限管理员。原浏览器 IndexedDB 战术导入仍通过管理端保留。
