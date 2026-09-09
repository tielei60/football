# 足球战术持久化服务

需要 Node.js 22.13 或更高版本。服务使用 Node.js 内置的 `node:sqlite` 实现持久化存储，无需安装额外的数据库服务或 SQLite 软件包。

后端目录 `server/` 与前端目录 `app/` 同级。请在 `app/` 目录中执行以下命令：

```sh
node ../server/index.mjs
node --test ../server/football.test.mjs
```

服务默认监听 `127.0.0.1:13001`。可通过 `PORT` 和 `HOST` 覆盖监听地址，通过 `FOOTBALL_DB_PATH` 指定 SQLite 文件。数据库默认位于 `app/data/football.sqlite`，路径相对于应用目录解析，不受当前终端目录影响；父目录不存在时会自动创建。默认监听地址仅供本机使用，当前服务不提供身份认证。

SQLite 启用 WAL、外键和预编译语句，写操作使用即时事务。备份时应先停止服务再复制数据库文件；服务运行期间应使用 SQLite 备份工具，因为活动数据库可能同时存在 `-wal` 和 `-shm` 文件。战术、历史版本、教练工作台、球队名单和具名战术集导入记录分别存入独立的业务表。球队名单按球员逐行保存，包含球员编号、姓名、球衣号码、位置、惯用脚、出场状态、备注、头像、场上元素编号和名单顺序。

球员可踢位置使用枚举数组：`门将`、`后卫`、`中后卫`、`边后卫`、`后腰`、`中场`、`前腰`、`边前卫`、`左边前`、`右边前`、`中锋`、`前锋`、`待定`。数组至少包含一项并自动去重。旧版 `position` 单字符串仍可作为输入，服务会将 GK、DF、MF、FW 等旧值转换为新的中文枚举；响应统一返回 `positions` 数组。

## 数据库业务命名

下表列出实际建表名称、全部字段及其业务含义。战术板内容包括球员、足球、标记、训练计划和战术演示；球队名单按球员逐行保存。

| SQL 表名             | 中文业务含义 | 实际字段及含义                                                                                                                                                                                                                                                                       |
| -------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tactics`            | 战术库       | `tactic_id` 战术编号；`title` 战术名称；`tags` 战术标签；`favorite` 收藏状态；`formation_name` 阵型名称；`match_details` 比赛信息；`board` 战术板内容；`thumbnail` 战术缩略图；`created_at` 创建时间；`saved_at` 保存时间；`preset_name` 预置战术名称；`preset_edition` 预置战术版本 |
| `tactic_versions`    | 战术历史版本 | `version_id` 历史版本编号；`tactic_id` 所属战术编号；`note` 保存备注；`board` 此版本的战术板内容；`created_at` 版本创建时间                                                                                                                                                          |
| `coaching_desks`     | 教练工作台   | `desk_id` 工作台编号；`board` 当前战术板内容；`selected_tactic_id` 当前关联战术编号；`edition` 工作台保存版本号；`saved_at` 保存时间                                                                                                                                                 |
| `team_players`       | 球队名单     | `player_id` 球员编号；`desk_id` 所属工作台编号；`team_order` 名单顺序；`name` 球员姓名；`shirt_number` 球衣号码；`position` 可踢位置数组（JSON）；`preferred_foot` 惯用脚；`availability` 健康或停赛状态；`note` 球员备注；`portrait` 球员头像；`field_piece_id` 关联的场上球员编号  |
| `tactic_collections` | 已导入战术集 | `collection_name` 战术集名称；`tactic_ids` 本次导入产生的战术编号；`imported_at` 导入时间                                                                                                                                                                                            |
| `app_migrations`     | 数据迁移记录 | `migration_name` 迁移名称；`applied_at` 执行时间                                                                                                                                                                                                                                     |

## API

所有 API 响应均禁止缓存。提交训练内容的请求必须使用 `Content-Type: application/json`，请求体上限为 25 MiB。错误响应格式为 `{ "message": "..." }`：训练内容无效返回 400，战术或路由不存在返回 404，操作不受支持返回 405，工作台版本冲突返回 409，请求体过大返回 413，请求格式不受支持返回 415。未预期的异常返回 500，响应中不会暴露数据库内部信息。

| 方法   | 路由                              | 请求                                                  | 响应                                                                      |
| ------ | --------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| GET    | `/api/tactics`                    |                                                       | `Tactic[]`，按最近保存时间优先排列                                        |
| POST   | `/api/tactics`                    | `{ tactic, note }`                                    | 201 `Tactic`                                                              |
| GET    | `/api/tactics/:tacticId`          |                                                       | `Tactic`                                                                  |
| PUT    | `/api/tactics/:tacticId`          | `{ tactic, note }`                                    | `Tactic`                                                                  |
| PATCH  | `/api/tactics/:tacticId`          | `{ favorite?, thumbnail? }`                           | `Tactic`                                                                  |
| DELETE | `/api/tactics/:tacticId`          |                                                       | 204                                                                       |
| GET    | `/api/tactics/:tacticId/versions` |                                                       | `Version[]`，最新版本优先                                                 |
| POST   | `/api/tactics/:tacticId/versions` | `{ note, board }`                                     | 201 `Version`                                                             |
| GET    | `/api/coaching-desk`              |                                                       | `{ desk, edition, savedAt }`                                              |
| PUT    | `/api/coaching-desk`              | `{ desk, edition }`                                   | `{ desk, edition, savedAt }`                                              |
| GET    | `/api/tactic-collections`         |                                                       | `{ tactics, versions, exportedAt }`                                       |
| POST   | `/api/tactic-collections`         | `{ tactics, versions, exportedAt?, collectionName? }` | 首次导入返回 201 `{ importedCount, tacticIds }`；战术集名称重复时返回 200 |

```ts
type Tactic = {
  tacticId?: number;
  title: string;
  tags: string[];
  favorite: boolean;
  formationName: string | null;
  match?: { opponent?: string; date?: string; score?: string };
  board: Board;
  thumbnail: string | null;
  createdAt?: number;
  savedAt?: number;
  presetName?: string;
  presetEdition?: number;
};

type Board = {
  pieces: object[];
  markings: object[];
  trainingPlan?: object;
  demonstration?: object;
};

type Version = {
  versionId: number;
  tacticId: number;
  note: string;
  board: Board;
  createdAt: number;
};

type TeamPlayer = {
  playerId: string;
  name: string;
  number: number;
  positions: Array<
    | "门将"
    | "后卫"
    | "中后卫"
    | "边后卫"
    | "后腰"
    | "中场"
    | "前腰"
    | "边前卫"
    | "左边前"
    | "右边前"
    | "中锋"
    | "前锋"
    | "待定"
  >;
  preferredFoot: string;
  status: "ok" | "injured" | "suspended";
  note: string;
  avatar?: string | null;
  fieldPieceId: string | number | null;
};

type CoachingDesk = {
  board: Board;
  players: TeamPlayer[];
  selectedTacticId: number | null;
};
```

战术板中的元素、标记、训练计划和战术演示会完整保留各项足球业务信息。战术演示包含参与元素、阶段、位置和跑动路线。战术板任意层级均拒绝已经停用的通用字段名。时间使用 Unix 毫秒时间戳。返回的战术始终包含战术编号和保存时间；新保存的数据使用服务器时间，导入战术集时保留数据中提供的时间。

保存战术和创建对应训练版本在同一个事务中完成。如果 POST 请求中的 `presetName` 与 `presetEdition` 组合已存在，服务会直接返回已有战术，不创建新版本，以避免并发导入预置战术时产生重复数据。每套战术只保留最近 50 个版本，并按训练时间和版本编号排序。修改收藏状态或缩略图不会创建版本，也不会更新保存时间。删除战术时会级联删除其历史版本；若教练工作台正关联该战术，只会解除关联，不改变战术板、球队名单或工作台版本号。

新建教练工作台的初始值为 `{ desk: null, edition: 0, savedAt: null }`。保存时必须提交最近一次读取到的 `edition`。保存成功后版本号加一，战术板和完整球队名单会一并写入。使用过期版本保存时返回 409，已有数据不发生变化。提交 `desk: null` 会清空战术板和球队名单，同时仍将版本号加一。若指定了当前战术，该战术必须已经存在。

战术集中的历史版本使用 `{ tacticNumber, note, board, createdAt? }`，其中 `tacticNumber` 表示该战术在同批 `tactics` 数组中的**从零开始的位置**。每次导入都会追加战术并分配新的编号，即使预置名称和版本相同也不会覆盖已有战术；任意战术或版本无效时，整批导入都会回滚。具名战术集只导入一次，再次提交相同 `collectionName` 时返回 `importedCount: 0` 和首次导入生成的战术编号。未命名战术集可以重复导入。导入操作不会替换教练工作台，只会加入请求中提供的历史版本。

## 服务端集成

```js
import { createFootballServer } from "../server/index.mjs";

const server = createFootballServer({
  databasePath: "/absolute/path/football.sqlite",
  staticDirectory: "/absolute/path/dist",
  maximumRequestBytes: 25 * 1024 * 1024,
});
server.listen(13001, "127.0.0.1");
```

工厂函数返回原生 `http.Server`。服务器触发关闭事件时会同时关闭 SQLite。命令行入口收到 SIGINT 或 SIGTERM 后会关闭服务器。生产环境默认提供 `app/dist` 中的静态资源，页面路由找不到对应文件时回退到 `index.html`；缺失的静态资源和未知 API 路由仍返回 404。

集成测试通过真实 HTTP 路由和临时 SQLite 文件验证服务，覆盖数据库重新打开、Node 进程重启、校验失败后的事务回滚、版本保留与级联删除、名单和战术板一致性、乐观并发冲突、幂等导入、请求大小限制以及生产静态文件服务。
