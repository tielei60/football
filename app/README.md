# Coco TacticX

<p align="center">
  <a href="https://github.com/CJ-cooper6/coco-tacticx">
    <img src="https://raw.githubusercontent.com/CJ-cooper6/coco-tacticx/refs/heads/main/public/logo.svg" alt="Logo" width="80" height="80">
  </a>

  <p align="center">
    一款基于 Vue 3、SVG 的足球战术画板。
    <br />
    <br />
    <a href="https://cocotactic.cn">在线访问</a>
  </p>
  <div align="center">
  <figure>
    <a target="_blank" rel="noopener">
      <img src="https://raw.githubusercontent.com/CJ-cooper6/coco-tacticx/refs/heads/main/public/case-2.png" alt="showcase"/>
    </a>
  </figure>
</div>
</p>

## 🎯 特性

- 战术元素（球员、球、路线等）
- 工具栏(选择、绘制、标注等常用工具)
- 属性面板 (实时调整元素属性和样式)
- 动画演示功能
- 战术、动画、训练计划与球队名单保存到 SQLite
- 移动设备适配
- 导出为 PNG
- PWA

## 🔨 开发

需要 Node.js 22.13 或更高版本，使用 Node 自带的 SQLite，无需安装独立数据库服务。

前端位于 `app/`，Node/SQLite 后端位于同级的 `server/`。下列安装、启动、构建和测试命令均在 `app/` 中执行；运行时需要保留这两个同级目录。后端仅使用 Node 内置模块，无需另外安装依赖。

```sh
#克隆项目
git clone https://github.com/CJ-cooper6/coco-tacticx.git

#安装依赖
yarn install

#启动开发服务器
yarn run dev
```

`npm run dev` 同时启动前端和后端。前端默认地址为 `http://127.0.0.1:15173/board`，后端默认监听 `127.0.0.1:13001`。
端口占用时可用 `PORT=13002 npm run dev -- --port 15174`，前端会自动连接所指定的后端端口。

### 使用 Makefile 管理服务

在项目根目录（`app/` 的上一级）执行，默认启动后台开发服务，前端支持热更新，后端支持文件变更后自动重启：

```sh
make help               # 查看中文帮助
make start              # 启动前后端
make stop               # 停止前后端
make restart            # 重启前后端
make status             # 查看运行状态、进程号和实际端口
make logs               # 查看最近 50 行日志
make start-frontend     # 单独启动前端
make stop-backend       # 单独停止后端
make restart-backend    # 单独重启后端
make status-frontend    # 单独查看前端状态
make logs-backend       # 单独查看后端日志
make test-services      # 验证服务管理命令
make start FRONTEND_PORT=15174 BACKEND_PORT=13002  # 自定义端口
```

每种操作均支持 `-frontend` 和 `-backend` 后缀。默认仅监听本机，端口为前端 15173、后端 13001；端口占用时会报错，不会自动换端口。重复启动不会创建多份进程，修改端口需使用 `restart` 并传入新端口。前端启动时优先连接 Makefile 已启动的后端实际端口；单独更改后端端口后也应重启前端。

日志与进程记录位于 `app/.run/`，已加入忽略规则。使用 `tail -f app/.run/*.log` 可持续查看日志，按 Ctrl+C 仅退出日志查看。停止命令仅管理 Makefile 启动的进程，不会停止通过 `npm run dev` 或其他方式启动的服务。状态表示进程是否存活，接口异常请结合日志排查。全部启动过程中若其中一个服务失败，已启动的服务会保留，可修复后再次 `make start` 或执行 `make stop`。

可通过环境变量 `FOOTBALL_DB_PATH` 指定数据库，`FOOTBALL_RUN_DIR` 指定独立的进程记录与日志目录。测试使用临时目录和临时数据库。若管理命令被强制终止而留下 `app/.run/lock`，确认没有其他管理命令执行后可删除这个空目录再重试。

生产运行：`npm run build` 后执行 `npm start`，由后端统一提供页面与接口，访问 `http://127.0.0.1:13001/board`。

### 战术保存

- 数据库默认位于 `app/data/football.sqlite`，可通过 `FOOTBALL_DB_PATH` 指定绝对路径。
- 战术显式保存时，同时生成历史版本；每套战术保留最近 50 个版本。
- 教练工作台自动保存当前站位、标注、训练计划、演示阶段与球队名单；保存状态确认完成后，刷新页面或换用浏览器仍可继续。
- 同时打开多个页面时，过期页面不会覆盖较新的工作台；可先下载当前草稿，再载入最新内容。
- 旧浏览器战术通过“导入本机战术”追加到战术库，重复导入不会重复创建，原有浏览器数据保留。
- 第一次连接空工作台时，沿用当前浏览器的名单和草稿；已有工作台以保存内容为准。
- 战术库仍支持文件导入、整库导出和版本回滚。完整迁移或备份数据库时，先停止服务，再复制数据库文件；运行中的数据库应使用 SQLite 备份工具，不能只复制主文件而遗漏日志。
- 当前为单球队共享工作台，默认仅本机访问；不包含账号与权限系统。

接口与表结构说明见 [server/README.md](../server/README.md)。接口、表、字段使用业务名称，例如 `tactics`、`tactic_versions`、`team_players`、`coaching_desks`，以及 `trainingPlan`、`demonstration`、`stages`。

## 柏林花园 FC 工作台

- `/` 和 `/board` 直接进入战术工作台；原介绍页保留在 `/about`。
- 名单支持姓名、号码和出场状态筛选，伤停队员不会被一键阵型选入。
- 球员档案支持选择多个可踢位置，内置门将、后卫、中场、前锋及细分位置枚举；初始 20 人位置来自人员名单 CSV。
- 替补队员详情支持原位换人，继承被换下队员的位置与场上职责；切换阵型保留已选阵容。
- 训练计划可记录目标、时长和执教要点，随战术保存、版本回滚、JSON 备份及打印同步。
- 战术库支持另存新方案；换人、名单编辑与训练计划均支持撤销和重做。
- 动画编排支持拖动时间轴、暂停续播、实时倍速、单次或循环播放、步骤名称与要点、独立过渡时长，以及在当前步骤后添加或删除步骤。
- 动画与战术一起保存，支持版本回滚、JSON 导出和整库备份；返回战术板后再次制作可继续已有动画。
- 动态场景包含边路传中、高位逼抢、稳守反击，主客队与足球分步联动。十套进阶预置附带适用场景、执行分工及防守保护，导入时保留旧方案。
- 绘图工具与球场缩放独立，支持战术保存、版本历史、动画、打印和图片导出。
- 战术及名单统一保存到后端 SQLite；显示偏好仍保留在当前浏览器。

### 验证

```sh
npm run build
npm run test:server
npx playwright install chromium
npm run test:e2e
```

浏览器测试使用独立的临时 SQLite 数据库与浏览器会话，测试服务使用 3003 和 5175 端口，结束后清理，不会改动日常球队数据。已安装 Chromium 时，也可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定可执行文件路径。开发调试面板通过 `/board?debug` 开启。

## 💕交流

本项目倾注了不少心血，如果觉得不错，别忘了给我们的 GitHub 仓库点个星🌟哦！欢迎加入我们的社区，一起聊聊战术板开发技术、足球战术和比赛复盘，期待与你碰撞出更多火花，感谢支持！

<p align="center" style="display:flex; justify-content: flex-start;" >
    <img src="https://raw.githubusercontent.com/CJ-cooper6/coco-tacticx/refs/heads/main/public/wechat-mp-1.png" width=200 height=300/>
    <img src="https://raw.githubusercontent.com/CJ-cooper6/coco-tacticx/refs/heads/main/public/qq-group-1.jpg" width=170 height=300/>
 </p>

## 🚀赞赏

如果本项目对你有帮助，欢迎支持开发工作，为代码加点"燃料"🚀！

<p align="center" style="display:flex; justify-content: flex-start;" >
    <img src="https://raw.githubusercontent.com/CJ-cooper6/coco-tacticx/refs/heads/main/public/wechat-payment-qr-code.jpeg" width=200/>
    <img src="https://raw.githubusercontent.com/CJ-cooper6/coco-tacticx/refs/heads/main/public/alipay-payment-qr-code.png" width=200/>
 </p>
