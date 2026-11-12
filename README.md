# 足球俱乐部管理

Vue 3 + Node.js + SQLite，面向业余俱乐部。保留原有战术板、阵型、动画、版本、导入导出与打印，新增管理端和球员端。

## 功能

- 管理员管理球员、创建球员账号、重置密码；球员只操作自己的报名，所有账号可修改密码。
- 比赛草稿、发布、取消、完成；参加 / 不参加 / 待定报名；名单、位置、实际出场、比分、进球、助攻与复盘。
- 自定义起止日期赛季，可跨自然年；赛季和自然年独立查询。报名不等于出场，未记录不当作 0，统计展示已知数据覆盖。
- 比赛关联现有战术。数据库包含球队归属，当前界面只管理一支球队，尚不提供多队切换。
- REST 接口供网页使用，为后续微信小程序复用保留边界；本次没有小程序、微信登录、财务、费用、训练签到。

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

所有服务端与浏览器测试使用临时 SQLite，不使用业务数据库。`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium` 可使用本机 Chromium。CI 在每次推送和 PR 运行同样的构建、服务端与浏览器回归。

## 升级和部署

先阅读 [部署与备份](docs/deployment.md)。现有 SQLite 会保留原表，新建 `club_*` 表并迁移已有名单 ID。禁止删除数据库、用测试库覆盖或在运行中只复制 SQLite 主文件。

API 见 [接口说明](docs/club-api.md)。旧战术 API 保持数据格式，但现在必须登录，写入仅限管理员。原浏览器 IndexedDB 战术导入仍通过管理端保留。
