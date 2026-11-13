# 部署、升级与恢复

## 运行方式

推荐 Node.js 24 LTS，单进程应用 + 本地持久化 SQLite。Dockerfile 从仓库根目录构建，包含前端构建产物与 Node 后端，使用非 root 用户。原来仅 Nginx 的镜像不能运行 SQLite API，已替换。

```sh
cp .env.example .env
# 编辑 .env，填写首次管理员用户名与至少 10 位强密码
# 访问地址若为 https://football.example.com：
# FOOTBALL_PUBLIC_ORIGIN=https://football.example.com
# FOOTBALL_COOKIE_SECURE=true
docker compose up -d --build
```

默认只绑定宿主机 `127.0.0.1:13001`，通过可信 HTTPS 反向代理访问。代理保留 Host 与浏览器 Origin，不要将其他站点加入允许列表。`FOOTBALL_PUBLIC_ORIGIN` 必须为浏览器实际使用的精确 origin，不能含路径。不要公开开发服务器或直接暴露 HTTP 登录到互联网。设置 HTTPS origin 或 COOKIE_SECURE=true 后，HTTP 浏览器不会携带登录 Cookie，这是预期保护。可信代理和客户端地址配置见 [安全部署说明](security-deployment.md)，不要盲信转发头。

数据在命名卷 `football-data` 的 `/data/football.sqlite`。不执行 `docker compose down -v`，它会删除数据卷。首次管理员创建成功后从 .env 删除两个 ADMIN 变量并重建容器，密码保存在 SQLite 的 scrypt 哈希中。无管理员时登录不能使用；不存在匿名创建管理员接口。

命令行与本地脚本默认不会自动加载 .env。非 Docker 部署请用进程管理器注入变量：HOST、PORT、FOOTBALL_DB_PATH、FOOTBALL_PUBLIC_ORIGIN、FOOTBALL_COOKIE_SECURE。默认监听 127.0.0.1。

## 升级已有数据库

1. 记录当前提交与运行命令。先执行一致性备份并保留旧版本代码。
2. 停止旧进程。把新版本指向**同一个** FOOTBALL_DB_PATH；不要运行测试库覆盖业务库。
3. 新增 club\_\* 表是兼容性迁移，不删除旧 tactics、版本、desk 或 team_players。名单沿用旧 player_id，战术继续可打开。
4. 新增历史快照按迁移当时的模板及名单资料补录，界面标明来源；无法从当前资料恢复此前未保存的赛时姓名、号码或战术。原有比赛的赛事、人数制、主客场、首发/替补与赛季归属保持未知或未归属，不按日期猜赛季。管理员可在比赛详情逐一补齐归属。
5. 创建首次管理员，验证登录、原战术、名单和新功能。首次迁移后仍需保留升级前备份。
6. 移除 bootstrap 密码环境变量。备份文件包含账号哈希与俱乐部私人数据，限制读取权限，勿上传仓库。

## 一致性备份

```sh
# 本地部署，可在低负载时在线执行，使用 SQLite VACUUM INTO：
FOOTBALL_DB_PATH=/absolute/path/football.sqlite node scripts/backup.mjs /absolute/backup/football-YYYYMMDD.sqlite
```

备份目标必须不存在，脚本不会覆盖源库或已有备份，并对结果执行 integrity_check。新备份文件为 Unix 0600，新建目录为 0700，仅所有者可访问。脚本使用 SQLite 一致性快照，不能简单在线复制主文件而遗漏 WAL。

Docker 可执行 `docker compose exec football node scripts/backup.mjs /data/backup-YYYYMMDD.sqlite`，然后用 `docker compose cp football:/data/backup-YYYYMMDD.sqlite ./backup-YYYYMMDD.sqlite` 把备份另存到安全位置。另一个选择是先停止容器后备份整个命名卷。恢复前先停止服务。

恢复：停止服务，将已验证的备份放入一个**新目录**，设置 FOOTBALL_DB_PATH 指向它，保留原数据库及其 -wal/-shm 文件作为恢复保障，启动并核对。不要在已有活跃 WAL 文件旁直接替换 SQLite 主文件。旧版应用回滚请使用升级前一致性备份，不能假定旧代码理解新管理记录。

## 当前边界

- 没有部署到用户的真实生产服务器。本仓库提供可重复部署配置。
- 当前只开放一个球队的用户流程，表和查询保留 team_id。原战术工作台仍属于初始球队，不声称已经提供完整多租户战术编辑器。
- 赛果、出场、进球和助攻只计算已完赛比赛；空白比分与个人数据为未知，已知部分的合计须结合覆盖数解读。赛季统计按明确归属，年度独立按比赛日期；未归属比赛仍参与对应年度统计，不混入任何赛季。报名统计的状态范围与未回复覆盖见界面说明。
- 小程序需另行实现平台登录、域名白名单、会话携带和发布，不把网页 Cookie 登录等同于已实现微信登录。

## 安全检查范围

相册上传使用 `sharp` 完整解码，以拒绝仅有文件头但无法显示的假图片；前置编码/容量/尺寸检查与完整解码都通过后才可写库。运行服务器前须在 `app` 目录执行 `npm ci`，不要只复制 `server` 目录。Docker 在与运行层一致的 Node 24 Alpine 平台安装并保留生产依赖，CI 还在实际容器中解码样例图，避免遗漏本机图像库。网站图片数据仍全部存入 SQLite，持久卷及备份方式不变。

地图使用按需加载的 Leaflet；原应用 JS 预算仍为 850 KB，地图引擎另限 160 KB，明确分包并从 PWA 预缓存排除，不通过整体调高原预算掩盖首屏增长。地图瓦片只在主动打开地图后请求，不离线预取。

生产依赖审计和完整开发依赖告警以对应提交 CI 为准，不执行审计建议的强制不兼容降级。开发服务仅绑定本机，不要用作生产服务或处理不可信源码。告警数量会随安全数据库更新变化。
