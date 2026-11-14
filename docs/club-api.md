# 俱乐部 REST API

所有响应均为 JSON，错误格式为 `{message}`。同源 fetch 会自动携带会话 Cookie。浏览器写请求必须具有同源 `Origin`（由浏览器提供），或符合配置的 `FOOTBALL_PUBLIC_ORIGIN`。原生 Bearer 请求使用下文独立的鉴权传输方式，不携带 Cookie 或 Origin。不提供公开注册。命令行 `FOOTBALL_ADMIN_USERNAME=owner FOOTBALL_ADMIN_PASSWORD='at least 10 chars' node server/bootstrap-admin.mjs` 仅用于初始化首个管理员。

- POST `/api/auth/login` `{username,password}` -> 下述会话对象
- GET `/api/auth/me` -> `{user:{id,username,role:'admin'|'player',playerId:string|null,teamId:number},team:{id,name,crest,revision}}`；未登录返回 401
- POST `/api/auth/logout` `{}` -> 204
- PUT `/api/auth/password` `{currentPassword,newPassword}` -> 204，撤销会话，需重新登录
- GET `/api/team` -> `{id:number,name:string,crest:string|null,revision:number}`（已认证的本队成员）
- PUT `/api/team` `{revision:number,name?:string,crest?:string|null}` -> Team（仅本队管理员）。名称会去除首尾空白，不能为空，最多 200 个字符。队徽接受 image/png、image/jpeg、image/webp 或 image/gif 的规范 base64 数据 URL，必须匹配位图文件签名，解码后最多 2 MiB。拒绝外部 URL、SVG、错误编码及不匹配的文件签名。请求大小上限为 3 MiB。将 crest 设为 null 可移除队徽。必须提供 revision，缺失或无效返回 428，过期返回 409。登录和 auth/me 返回完整的当前球队对象。
- 球员照片集：`/api/players/:id/photos`，管理员上传、排序、封面、说明及删除；同队成员只读可见照片，头像独立。详细方法、revision、幂等及限制见[球员照片集接口](player-photo-album-api.md)。
- GET `/api/players` -> Player[]
- POST `/api/players` 提交 Player 字段 -> Player（管理员）
- PUT `/api/players/:id` 提交部分 Player 字段及 `revision` -> Player（管理员）
- POST `/api/players/:id/account` `{username,password}` -> `{id,username,role,playerId,teamId}`（管理员，为球员创建登录账号）
- PUT `/api/players/:id/password` `{newPassword}` -> 204（管理员，重置密码并撤销会话）
  Player = `{id:string,revision:number,name,number:number|null,positions:string[],preferredFoot:string,status:'active'|'inactive',note:string,avatar:string|null,hasAccount:boolean}`。保留已有旧版字符串 ID，新记录生成新 ID。不提供破坏性的球员删除操作，以 inactive 状态归档。战术工作台和俱乐部名单按稳定 ID 同步。修改俱乐部球员资料会递增战术工作台 edition，过期工作台保存返回 409，不会覆盖新资料。归档会撤销该球员的会话。

- GET `/api/seasons` -> Season[]
- POST `/api/seasons` `{name,startDate,endDate}` -> Season（管理员）
- PUT `/api/seasons/:id` 接受上述字段的部分更新及 `revision` -> Season（管理员）
  Season = `{id:number,revision:number,name,startDate:'YYYY-MM-DD',endDate:'YYYY-MM-DD'}`。允许任意包含起止日期的时间范围，也允许范围重叠。比赛归属必须显式指定，不根据重叠日期推断。缩小范围导致已分配比赛落在范围外时返回 409。

- GET `/api/matches` -> Match 摘要（不含 tacticSnapshots）；球员仅可见 published/completed/cancelled，管理员还可见 draft
- POST `/api/matches` 提交 Match 可编辑字段 -> Match（管理员）
- GET `/api/matches/:id` -> Match
- PUT `/api/matches/:id` 提交部分 Match 可编辑字段及 `revision` -> Match（管理员）
- PUT `/api/matches/:id/rsvp` `{response:'yes'|'no'|'maybe'}` -> Match（只能修改自己的球员回应，且比赛必须为 published）
- PUT `/api/matches/:id/roster` `{revision:number,roster:[{playerId:string,position:string,appeared:boolean|null,goals:number|null,assists:number|null}]}` -> Match（管理员，全量替换名单）
  Match = `{id:number,revision:number,opponent:string,date:'YYYY-MM-DD',kickoff:string,location:string,status:'draft'|'published'|'completed'|'cancelled',homeScore:number|null,awayScore:number|null,analysis:string,tacticIds:number[],rsvps:[{playerId,response}],roster:[{playerId,position,appeared,goals,assists}]}`。创建必填 opponent/date，其余默认值按字段为空、draft、null 或 []。可编辑字段还包括 competition:string（默认 ''）、format:5|6|7|8|9|11|null、side:'home'|'away'|'neutral'|'unknown'（默认 unknown）及 seasonId:number|null。分配的赛季必须属于同队且包含比赛日期。旧比赛迁移为 seasonId=null、side=unknown，不推断缺失值。只有 completed 比赛计入统计。报名回应不等于出场。除非 appeared=true，否则进球和助攻必须为 null。`kickoff` 是可选的本地时间 HH:mm 字符串。战术 ID 会按球队战术范围校验。比分允许 null 表示未知，也保留明确的 0。homeScore 表示我方比分。已知进球、助攻各自的总数不得超过已知 homeScore；修改比分和修改名单时均执行此校验。

- GET `/api/statistics?year=2026` 或 `?seasonId=1` -> `{filter:{startDate,endDate,label},matches:number,matchesWithoutRoster:number,team:{matches:number,scoredMatches:number,wins:number,draws:number,losses:number,goalsFor:number|null,goalsAgainst:number|null,goalsForKnownMatches:number,goalsAgainstKnownMatches:number},players:[{playerId,name,appearances:number,unknownAppearances:number,unrecordedMatches:number,goals:number|null,assists:number|null,goalsKnownMatches:number,assistsKnownMatches:number}]}`。不传筛选条件时默认当前自然年，只允许一种筛选条件。合计仅累加已知记录；没有已知记录时为 null，覆盖数字段表示完整程度。出场计数要求 appeared=true。unknownAppearances 统计名单中明确 appeared=null 的行。matchesWithoutRoster 统计完全没有名单行的已完赛比赛。每名球员的 unrecordedMatches 统计其没有任何名单行的已完赛比赛，包括仅记录了部分名单的比赛。缺行表示未记录，不代表确认未出场；明确 appeared=false 的行才表示确认未出场。所有覆盖计数使用相同比赛范围：赛季按显式 seasonId，自然年按含起止日期的比赛日期范围。赛季日期范围不会隐式分配比赛。统计保留所有球员，包括 inactive 球员。

旧有 `/api/tactics`、`/api/coaching-desk`、`/api/tactic-collections` 及战术版本接口保持原请求/响应约定；读取需认证，写入仅管理员。旧战术板资源属于原始球队，其他球队身份不能访问。所有俱乐部业务表均按球队隔离。

### 战术名单同步

工作台 PUT 返回按持久化工作台顺序排列的规范名单，随后附加仅存在于俱乐部的在队球员资料。客户端没有更新的本地待保存编辑时，必须采用规范响应。保存非 null 工作台时，会归档上一次规范名单中存在、但在新名单中被明确省略的球员 ID，包括之前附加的俱乐部独有球员。首次创建战术板前不存在上一份规范名单，因此保留并附加已有俱乐部球员。创建或编辑俱乐部球员资料会递增已有工作台 edition，尚未收到新名单的旧客户端无法静默移除新球员。归档撤销会话，但保留账号和比赛历史。将已归档 ID 显式加入当前 edition 的工作台可恢复在队状态。null 工作台只重置战术板，不归档成员。工作台写入、名单同步及归档/会话变更在同一事务中提交。

### 并发与历史数据

Player、Match 和 Season 均有从 1 开始的整数 revision 字段。更新已有记录必须提交开始编辑时读取的 revision；缺失或无效返回 428，过期返回 409，均不修改数据。比赛资料与全量名单替换共用同一个 Match revision。更新成功时原子递增版本。发生冲突时，客户端必须保留编辑并显式重新载入或核对，不得静默获取新 revision 后重试旧的完整对象。报名更新只影响调用者自己的回应，不修改 Match revision。旧战术编辑仅在球员资料字段或在队状态实际变化时递增 Player revision；纯战术板或无变化保存不会递增。

新增或修改的球员头像仅接受经过校验的 PNG/JPEG/WebP/GIF base64 位图，解码后最多 2 MiB。未修改的旧头像原样保留，不重新校验，包括旧的 20 Mi 字符图片和本地路径，因此资料编辑和归档保持兼容。HTTP 战术工作台保存对变化的值采用同样校验，并额外允许安全的同源本地位图路径；拒绝外部 URL、编码或斜杠来源混淆、SVG 以及查询参数/片段。启动迁移保留旧值。球员请求体沿用服务端最大值，默认 25 MiB；部分更新可避免重新传输未变化的图片。

球队统计与球员统计使用相同的已完赛比赛、球队及显式赛季归属或自然年范围。scoredMatches 统计双方比分均已知的比赛，胜平负仅使用这些比赛。goalsFor 和 goalsAgainst 独立累加已知值，没有对应已知比分时为 null；各自的 KnownMatches 字段表示覆盖范围。缺失的一方比分不会被当作 0，也不用于判断赛果。

比赛关联战术会保留独立、不可变的快照，因此编辑模板、裁剪版本和删除模板均不改变比赛历史。仅当异常的旧关联缺少快照时才阻止删除。

### 对手交锋记录

统计还返回 `opponents: Array<{opponent:string,matches:number,scoredMatches:number,wins:number,draws:number,losses:number,goalsFor:number|null,goalsAgainst:number|null,goalsForKnownMatches:number,goalsAgainstKnownMatches:number}>`。按去除首尾空白后的对手名称分组，不合并大小写或内部空白差异；范围仅包含已认证球队中显式归属所选赛季，或日期位于所选自然年的已完赛比赛。各字段与球队汇总采用相同的独立比分覆盖规则；完全未知的比分不当作平局或零进球记录。按比赛数降序、再按名称排序。不提供独立对手实体或模糊名称匹配。

### 比赛历史快照

Match 增加 `tacticSnapshots: Array<{sourceTacticId:number,tactic:Tactic,capturedAt:number,captureSource:'association'|'migration'}>`。首次关联时捕获完整的当前战术，独立于模板和版本表保存。删除模板后保留已有 tacticIds 与快照，普通比赛编辑也保留它们。显式移除关联后再次添加，会重新捕获当时的模板，且该模板必须仍存在。

每个名单行增加 `playerSnapshot:{id:string,name:string,number:number|null,positions:string[]}`、`snapshotCapturedAt:number` 和 `snapshotSource:'roster'|'migration'`。首次保存名单时捕获这些身份与显示字段。之后修改进球、出场或当前球员资料不会刷新已有快照。显式移出名单再重新加入时才捕获新值。客户端只提交可编辑名单字段，传入的快照字段会被忽略。

旧记录没有快照。增量迁移会捕获迁移时可获得的值，并标记为 migration，而不是还原最初的历史状态。只读历史界面必须显示这一来源。快照遵循比赛的球队与角色可见性；客户端不得以当前模板或球员资料替换已保存的历史值。

### 显式赛季、赛季阵容与出勤

GET `/api/seasons/:id/roster` 返回 `{season:Season,roster:Array<{playerId:string,name:string,number:number|null,positions:string[]}>}`。同一路由 PUT 接受 `{revision:number,roster:Array<{playerId:string,number?:number|null}>}`，全量替换赛季阵容。仅管理员可写，所有本队成员可读。此接口与赛季名称、日期修改共用 Season revision。成员必须属于本队。已有赛季身份和位置字段保持固定，号码可显式修改。移除成员不会删除历史比赛快照。首次捕获比赛名单时，优先使用已分配赛季中的身份和号码，否则使用当前球员资料；同一行的后续保存不会刷新快照。

比赛名单行包含可编辑的 `selection:'starter'|'bench'|'unknown'`，默认 unknown，与实际 appeared 和报名回应独立。替补也可以 appeared=true；名单身份不会隐含出场结论。

赛季统计只使用显式 match.seasonId，自然年统计只使用比赛日期。旧记录保留 seasonId=null，继续出现在年度统计中。`unassignedMatches` 是全队未分配赛季的 published/completed 比赛总数，不受当前筛选范围限制，供界面提示需要分配的记录。比赛日期超出已分配赛季返回 400；赛季范围编辑排除已有比赛返回 409；跨队赛季引用返回 404。

统计增加 `registrationMatches:number`，统计所选赛季或年度中的 published/completed 比赛。每名球员增加 `registration:{yes:number,no:number,maybe:number,unanswered:number}`。草稿和取消比赛不计入；未回复属于 unanswered，不是 no。`team.attendance:{confirmedAppearances:number,unknownAppearances:number,matchesWithoutRoster:number}` 仅使用已完赛比赛及实际名单出场记录，不使用报名回应。未知出场统计明确 appeared=null 的行；缺行仍由已有 unrecordedMatches 和 matchesWithoutRoster 覆盖字段表示。

### 快照响应限制

只有 GET `/api/matches/:id` 包含完整 tacticSnapshots。GET `/api/matches` 省略它们，避免列表加载所有历史战术板，但保留 tacticIds 及正常比赛/名单字段。每场比赛新增关联后的战术快照 UTF-8 序列化总量限制为 32 MiB，超出返回 413 并回滚整个编辑。该上限可容纳一份此前合法的 25 MiB 战术。已有迁移快照即使超过上限也完整保留；未新增快照的编辑不会因此拒绝或截断旧内容。

### 原生小程序鉴权传输

`POST /api/auth/native-login` 携带 `X-Football-Client: native-v1` 和 JSON `{username,password}`，返回 `{token,expiresAt,user,team}`，不设置 Cookie。`expiresAt` 为 Unix 毫秒时间戳。这是俱乐部账号认证，不是微信身份认证。

后续路由使用 `Authorization: Bearer native_<64 hex chars>`，不发送 Cookie 或 Origin。拒绝 Fetch Metadata 请求头，唯一例外是微信 Electron 模拟器的精确组合：Sec-Fetch-Site=same-site、Sec-Fetch-Mode=cors、Sec-Fetch-Dest=empty，且不得有额外 Sec-Fetch 请求头。此组合不是身份认证凭据，浏览器 Origin/Cookie 拒绝规则仍然有效。支持微信平台 Referer。原生与浏览器令牌不能互换。两者共用已有角色/球队授权，以及密码重置、归档、到期和退出撤销机制。浏览器 Cookie 写请求仍需通过原有 Origin 校验。响应继续使用 no-store，不添加通配 CORS。原生登录共用已有按地址/账号限制的尝试限流器。

参见[原生客户端部署与验收](wechat-miniprogram.md)。不使用 AppSecret，也不向客户端发送 AppSecret。

### 球场与比赛地点快照

GET/POST /api/venues；GET/PUT /api/venues/:id。本队成员可读，管理员可写。字段包括 id、revision、name（最多 200 字符）、address（最多 300 字符）、latitude、longitude、coordinateSystem（gcj02）、status（active/inactive）。经纬度必须同时为 null，或同时为范围内的有限数值。更新要求 revision，过期写入返回 409。跨队引用返回 404。不提供删除路由。

Match 接受 venueId（number/null），返回 venueSnapshot（name/address/latitude/longitude/coordinateSystem）。省略或未变化的 venueId 保留历史；关联新的在用球场时捕获其数据。停用球场不能新增关联。显式 null 解除关联，并允许手动 location。新关联中省略 location 时使用球场名称/地址。客户端提交的快照会被忽略。增量迁移保留旧的自由文本 location 和 revision。微信地图使用 GCJ-02，不得静默替换为 WGS84/BD09。

### 原生赛季阵容编辑器

原生 `season-roster` 页面使用上述已有 GET/PUT `/api/seasons/:id/roster` 约定，不另建名单模型。客户端仅发送 `{revision,roster:[{playerId,number}]}`。空号码转为 null，明确的 0 保留。同队已归档球员可以保留在赛季阵容中或被选入，界面单独显示其状态。赛季姓名和位置仍使用保存值，赛季号码不会更新当前 Player。移除成员并保存后再加入，会捕获当前身份字段；尚未保存的移除再加入保留原赛季快照。球员账号仅可读取。原生编辑器遇到 409 保留输入并要求显式重新载入，不静默替换期望 revision。

### 比赛须知与鉴权相册

Match 增加 `notice:string`（默认空字符串，最多 10000 字符）和 `coverPhotoId:number|null`。须知通过已有 Match POST/PUT 字段编辑，沿用管理员/球队授权和 Match revision。相册写入与比赛资料、名单更新共用同一 Match revision。

`PhotoMetadata = {id:number,caption:string,mimeType:'image/png'|'image/jpeg',byteSize:number,createdAt:number}`。`createdAt` 为 Unix 毫秒时间戳。路由如下：

- GET `/api/matches/:id/photos` -> `{revision,coverPhotoId,photos:PhotoMetadata[]}`。仅返回按照片 ID 排序的元数据，列表不包含图片内容。
- GET `/api/matches/:id/photos/:photoId` -> `{...PhotoMetadata,dataUrl:string}`。每张图片内容独立鉴权，不是公开文件 URL。
- POST `/api/matches/:id/photos` `{revision,requestId,dataUrl,caption?}` -> `{revision,coverPhotoId,photo:PhotoMetadata}`（201；管理员）。
- PUT `/api/matches/:id/photos/cover` `{revision,photoId:number|null}` -> 当前相册列表（管理员）。非 null ID 必须指向本场比赛中未移除的照片。
- DELETE `/api/matches/:id/photos/:photoId`，JSON `{revision}` -> 当前相册列表（管理员）。

读取权限与所属 Match 一致，包括球队隔离和草稿可见性。写入要求管理员权限。浏览器或原生客户端不能仅凭照片 ID 绕过校验。浏览器写入保留 Origin 校验；原生写入使用上文的鉴权 Bearer 传输。

校验与存储：

- 每场最多 9 张未移除照片。图片必须为规范 base64 PNG/JPEG 数据 URL，具有有效文件头和尺寸，解码后最多 2 MiB。任一边最多 8192 像素，总像素最多 32000000。拒绝外部 URL、SVG、错误 base64、其他 MIME 类型和无效尺寸。上传 HTTP 请求体上限为 3 MiB。
- caption 可选，默认空字符串，最多 200 字符，存储前去除首尾空白。
- `requestId` 由 16–80 个 ASCII 字母、数字、下划线或连字符构成，以球队和比赛为作用域。原生客户端每次计划上传只生成一个新键，而非每次重试生成。
- 同一已有且未移除的请求，若图片内容哈希和去除首尾空白后的说明相同，则返回该照片及**当前** Match revision/封面，不重复插入，也不递增 revision。此幂等检查早于过期 revision 拒绝。复用键但内容/说明不同，或对应照片已移除，返回 409。因此丢失响应后可以安全重试原上传，但该键不是通用编辑机制。
- 新上传要求有效的当前 revision，缺失/无效返回 428，过期返回 409；成功后递增 Match revision。未设封面时，首次上传照片成为封面。
- 移除会标记照片已删除并清除存储的图片内容，保留请求记录以防重试恢复已删除照片。移除封面时，选择剩余未移除照片中 ID 最小的一张；没有照片则为 null。这不是面向用户的恢复功能。
- 相册表以及须知/封面字段采用 SQLite 增量迁移；旧比赛在未修改时保持空须知和 null 封面。

原生页面将结果未确定的上传内容放在同一登录、按比赛划分的私有进程内存中，不放入页面数据或持久会话存储。同一请求的重试和在途保护可跨该进程内页面重建保留；重启应用不保证草稿恢复。照片字节转换为本地缓存文件路径用于渲染。其他相册操作保留未保存的须知文本；显式丢弃/重新载入需确认。测试与发布状态另见 `wechat-miniprogram.md`。

### 原生战术位置专用接口

- GET `/api/tactics/:id/positions` -> `{tactic:Tactic,version:string}`。
- PUT `/api/tactics/:id/positions` `{version,positions:[{pieceId,x,y}]}` -> `{tactic:Tactic,version:string}`（管理员）。

这些路由沿用旧战术资源范围：原始球队的已认证用户可读，仅其管理员可写，拒绝其他球队。此接口不编辑比赛历史。

`version` 是当前完整战术序列化后的 64 位小写 SHA-256 十六进制摘要，由 GET 返回。客户端必须原样提交，不得自行序列化推导。缺失或格式错误返回 428；期望版本过期时，通过存储层已有乐观并发校验返回 409。

`positions` 为非空数组，最多 1000 个不重复的已有元素 ID。只允许移动 kind 为 `player` 的元素，包括旧数据中缺失 kind 的球员。坐标必须是规范战术板范围内的有限数值：`0 <= x <= 1250`、`0 <= y <= 826`。未知或重复 ID、足球及其他非球员元素、非数值坐标和越界值返回 400。仅修改提交的球员 x/y。服务端保留其他全部战术/战术板数据，设为 `formationCustomized:true`，清除过期缩略图，并通过已有战术/版本存储保存审计备注。

原生竖向球场仅是显示和输入变换；API 与存储仍使用规范的 1250 × 826 坐标空间。不要直接提交旋转后的屏幕像素。原生客户端中的球员账号和比赛关联历史快照均只读。当前模板位置编辑不会修改不可变的比赛战术快照，也不代表实现完整网页编辑器，包括绘图工具、完整序列编辑等。竖向渲染与拖动回归状态应以最终客户端验收报告为准，而不是本 API 约定。

### 原生原子战术命令接口

- GET `/api/tactics/:id/commands` -> `{tactic:Tactic,version:string}`。
- PUT `/api/tactics/:id/commands` `{version,commands:Command[]}` -> `{tactic:Tactic,version:string}`（管理员）。

沿用 `/positions` 的原始球队范围与鉴权：原始球队已认证成员可读，仅该队管理员可写，其他球队无法访问旧战术资源。浏览器写请求需通过已有 Origin 校验；原生写请求使用鉴权 Bearer 传输。这些路由编辑当前模板，不编辑比赛历史快照。

支持以下命令：

```json
{ "type": "move-piece", "pieceId": "player-or-ball-id", "x": 600, "y": 400 }
{ "type": "add-marking", "marking": { "markingId": "new-client-id", "kind": "arrow", "startX": 600, "startY": 400, "endX": 700, "endY": 300, "color": "#7453C8", "width": 3 } }
{ "type": "update-marking", "markingId": "existing-id", "patch": { "color": "#7453C8" } }
{ "type": "delete-marking", "markingId": "existing-id" }
```

以上每行是独立命令对象，不是完整请求。命令按数组顺序在独立副本上执行。每批必须包含 1–100 条命令；任一命令无效时整批拒绝，不保存前面的命令。成功批次仅保存一次并创建一个历史版本，即使修改了多个对象。

校验规则：

- 顶层只接受 `version` 和 `commands`，命令字段与变化的标记字段使用严格白名单。未知输入字段返回 400，不静默忽略。
- ID 为不含控制字符、最多 128 字符的非空字符串，或非负安全整数。字符串 ID 和数字 ID 不等价。移动/更新/删除目标必须唯一对应一个已有对象；新标记 ID 不得已存在。
- `move-piece` 仅支持球员（包括旧数据中缺失 kind 的元素）和足球。坐标仍为规范战术板空间中的有限数值，x 范围 0–1250，y 范围 0–826，不是原生旋转后的屏幕像素。
- 标记类型为 `line`、`arrow`、`rectangle`、`ellipse`、`pen` 和 `text`。允许的标记字段为 `kind`、`x`、`y`、`startX`、`startY`、`endX`、`endY`、`color`、`strokeColor`、`backgroundColor`、`width`、`path`、`dashed` 和 `label`。创建时还要求 `markingId`；补丁不得修改它，也不能为空。
- 完整标记要求四个起止坐标，提交坐标遵循相同战术板边界。宽度为有限数值 0.5–50。颜色为 3/4/6/8 位十六进制字符串或 `transparent`。`dashed` 为布尔值。标签最多 1000 字符，文字标记要求非空白标签。
- 路径最多包含 2000 个边界内、恰有两个值的 `[x,y]` 坐标对；画笔标记至少两个点。添加标记不得使战术板超过 5000 个标记。

`version` 为服务端返回的当前完整战术序列化内容的 64 位小写 SHA-256 摘要，与 `/positions` 共用。缺失或格式错误返回 428。服务端先校验版本，再校验目标，因此过期批次引用了之后被删除的对象时返回 409，而不是误导性的目标缺失错误。存储层在保存事务内再次校验相同期望版本，即比较并交换（CAS），避免覆盖并发的网页/原生保存。冲突不会部分应用批次；客户端必须显式重新载入并核对，不得获取新版本后自动重发旧编辑。

兼容性：命令保留未修改的已知及未知战术、战术板、元素和标记字段，包括演示和训练计划。补丁只校验变更字段，不剥离旧扩展字段。移动任意球员会设置 `formationCustomized:true`；只修改足球或标记则保留原值。成功保存清除过期缩略图，并使用已有审计/历史机制。现有 `/positions` 仍仅支持球员，约定不变。比赛关联的不可变快照保持不变。此窄范围命令 API 不替代完整网页编辑器或动画序列编辑。

此接口**没有持久化请求 ID 幂等约定**，不接受 `requestId`。超时或丢失响应不能证明保存失败。原生客户端在结果不确定时必须阻止继续保存，并显式重新读取服务端战术/版本后再核对编辑。不要盲目重放批次或给它分配新版本：已提交的请求可能已经创建历史记录。认证/权限失败仍遵循共用会话规则。

#### 原生球员属性与演示编排

同一原子 `/commands` 接口还接受：

- `update-piece {pieceId,patch}` 编辑初始战术板球员；`update-participant {pieceId,patch}` 编辑演示参与者。补丁字段：`label`（字符串，最多 100 字符）、`position`（字符串，最多 40）、`shirtNumber`（0–999 整数，或 null 表示清除）、`color`（与标记相同的十六进制/transparent 格式）、`radius`（有限数值 5–100）和 `team`（`home`/`away`）。仅球员类型对象可修改这些属性，包括旧数据中缺失 kind 的对象。拒绝空补丁及 `playerId` 等身份字段。清除号码会从存储及返回的规范对象中删除该可选属性，而不是存入 null。
- `init-demonstration {demonstrationId,title?}` 仅在没有演示时创建动画。将当前球员/足球复制到参与者，并将其坐标复制到阶段 0，时长 3 秒、标题 `步骤 1`。绝不覆盖已有演示。提交的演示标题最多 60 字符。
- `add-stage {afterStage,stage?}` 在已有、从零开始的阶段索引后插入，复制该阶段的位置和扩展字段。可选 `stage` 可覆盖 `title`、`note` 和 `durationSeconds`；默认新标题为 `步骤 N`，N 使用从 1 开始的显示序号。由于过渡变化，移除从 `afterStage` 出发的已有跑动路线，其后路线索引加一。
- `update-stage {stageNumber,patch}` 仅编辑标题（最多 60 字符）、备注（最多 1000）和 durationSeconds（有限数值 0.5–30）。补丁不能为空。
- `delete-stage {stageNumber}` 可删除任意已有阶段，但必须至少保留一个。移除进入或离开该阶段的路线，后续路线索引减一。剩余阶段从零连续编号，不自动推断跨越被删除阶段的替代路线。
- `move-participant {stageNumber,pieceId,x,y}` 只修改该阶段中已有参与者的位置，保留其他位置字段，不修改战术板元素或参与者基础坐标。
- `set-run {fromStage,pieceId,bend:{x,y}|null}` 创建或更新相邻阶段之间的参与者路线；null 表示移除。两个端点阶段都必须包含该参与者，末阶段没有出发路线。更新保留已有路线及 bend 的扩展字段。`bend` 沿用网页编辑器的路径点语义；服务端不计算另一种曲线，也不接受任意路径数组。

上述每个对象还需携带与命令名称一致的 `type` 字符串。阶段和路线索引以同批前面命令执行后的状态为准。规范 `stageNumber` 必须为从零开始的连续索引。演示最多 120 个阶段、128 个参与者；参与者 ID 及每阶段位置必须唯一，已有路线必须有效。动画编辑遇到无效旧动画结构时拒绝，不静默规范化；不相关的局部命令保留该结构。坐标与其他命令相同，使用规范 1250 × 826 范围。

战术板元素与演示参与者有意保持独立，即使 ID 相同。修改一方不会隐式重写另一方或俱乐部 Player 记录。客户端若希望显示属性一致，必须在同批中显式提交两条属性命令，以保留初始摆位与播放内容之间有意的差异。阶段操作保留不相关的训练计划、战术板元素、标记、演示元数据及扩展字段。沿用上述 CAS、历史、授权、批次限制和响应不确定规则，不授予全量替换战术板的权限。

#### 原生阵型目录、阵容与战术资料

GET `/api/tactics/:id/commands` 额外返回 `formations`，为 `{playerCount,id,name,category,spots:[{x,y,role}]}` 数组。目录覆盖网页已有的全部 5/6/7/8/9/11 人预设，包括特殊的 8 人定位球阵型。命令键使用 `id`，不能使用显示名称；部分旧 ID 与名称有意不同。坐标为规范的主队位置。服务端携带生成的 `native-formations.json` 快照，并有测试将其与 `app/src/data/eightFormations.ts` 和 `matchFormats.ts` 对照；生产不执行或导入网页 TypeScript。PUT 仍返回 `{tactic,version}`，不重复返回目录。

新增命令对象如下，每个均包含 `type`：

- `update-metadata {patch:{title?,tags?,favorite?}}`：补丁非空；title 去除首尾空白后不能为空，最多 300 字符；tags 最多 100 个字符串，每项最多 100 字符；favorite 为布尔值。不允许通过此命令修改其他战术字段。
- `add-player {pieceId,team,x,y,playerId?,label?,shirtNumber?,position?,color?,radius?}`：新增一个初始战术板球员，`team` 必须为 `home` 或 `away`。坐标和可选外观字段使用已有命令校验。每方最多 128 个场上球员。新 ID 不得与任何已有战术板元素或演示参与者冲突，包括同批中已移除其初始战术板对应元素的动画参与者，以免将旧动画身份静默复用到新球员。
- 提供 `playerId` 时，只允许 `home`。服务端在已认证球队内解析球员，要求 active 状态，并拒绝重复关联已经在战术板上的同一俱乐部球员。捕获俱乐部 ID、当前姓名和已知号码；客户端不得同时提供 `label` 或 `shirtNumber`。跨队/不存在的引用返回 404，停用或重复关联也会被拒绝。这是战术快照，不修改俱乐部 Player。未提供 `playerId` 时，元素为未关联的战术球员，适用于对手或匿名训练阵容。
- `remove-player {pieceId,acknowledgeAnimation?}`：仅移除一个初始战术板球员，不移除足球。如果同 ID 出现在演示参与者中，必须提供 `acknowledgeAnimation:true`，否则返回 HTTP 409 及 `{message,code:"ANIMATION_IDENTITY_CONFIRMATION_REQUIRED"}`。客户端必须明确说明移除只影响初始阵容，独立演示保持不变；不得推断同意或静默补标记重试。没有此依赖时可省略标记。新增/移除会将阵型标为已自定义，并保留模板来源。
- `apply-formation {team,playerCount,formationId,pieceIds}`：将目录预设应用到**所选一方当前的完整阵容**。`pieceIds` 按目录槽位顺序提供不重复的已有 ID，必须恰有 `playerCount` 项；所选一方也必须已经具有该数量的球员。缺失 kind 按旧球员处理，非 away 的 team 值按旧主队处理。命令不会静默创建、移除或选择俱乐部球员。阵容变更由客户端在同一原子批次前面显式提交新增/移除命令。

应用阵型只改变选中球员的坐标、位置角色和角色颜色，保留 ID、身份关联及其他字段。主队使用目录坐标；客队按 `1251 - x` 镜像，与网页球场边界一致，y 不变并使用网页客队颜色。主队应用设置 `board.formationId`、`tactic.formationName` 和 `formationCustomized:false`；客队应用设置 `board.awayFormationId`，不重置自定义标记。两者都设置共用的 `board.playerCount`。批次中显式移动球员的命令会保守地将最终战术板标为自定义。

**更改人数是双方共用赛制的变更，不是静默调整单方人数。** 当批次包含 apply-formation，且最终 playerCount 与原值不同（旧数据缺失时默认 8），服务端会在所有命令后检查双方。每个非空一方都必须达到最终人数，其非 null 阵型 ID 必须属于该人数的目录。可显式清空另一方；否则整批返回 400，不保存任何修改。客户端必须说明双方变更，并一起提交显式新增/移除/应用操作。同人数内仅重排选中一方，不隐式替换另一方。仍允许普通手动移除，并标记阵型已自定义。

这些操作不改变标记、训练计划、演示参与者/阶段/路线和不可变比赛快照。因此已有动画可以有意保留不同阵容，界面必须说明其独立作用范围。所有新命令共用已有 100 条批次限制、严格字段校验、管理员/球队授权、CAS、单次历史保存以及响应不确定规则。要求动画确认的 409 不是过期版本重试指令：用户显式确认后，仅当原版本仍为当前版本时才使用它；若之后发生 CAS 冲突，按正常流程处理。

## 微信邀请与身份认证（默认关闭）

后端新增同队管理员邀请、认领核验编号、审批、绑定和原生微信认证接口。完整字段、16 KiB限制、旧密码兼容、归档撤销与未完成客户端边界见[微信邀请认证后端接线说明](wechat-integration-contract.md)。未配置启用时公开能力接口仅返回 `wechat:false`，不接受测试身份或自动注册。
