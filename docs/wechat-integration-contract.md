# 微信邀请认证后端接线说明

本批已实现默认关闭的后端接线与隔离自动测试，不是已上线的微信登录功能。小程序邀请、审批、微信登录界面尚未接入；没有读取或配置真实 AppSecret、发送真实邀请、调用真实微信交换接口、生成扫码图片或迁移生产库。

## 1. 配置与身份边界

`.env.example` 的 `FOOTBALL_WECHAT_ENABLED=false` 为默认值。启用时由部署者在服务端配置 `FOOTBALL_WECHAT_APP_ID`、`FOOTBALL_WECHAT_APP_SECRET`，不得写进小程序、日志、截图或 Git。仓库 Compose 模板已显式转发这三项（默认关闭/空值）；直接运行 Node 时需要由部署环境显式设置，Node 不自动读取 `.env`。开启但参数缺失在打开业务数据库前报错；后续初始化失败关闭数据库连接，不回退测试身份。

`GET /api/auth/capabilities` 仅返回 `{ "wechat": false }` 或 `{ "wechat": true }`，不给出 AppID、密钥或绑定身份。本人登录响应及 `auth/me` 的 `user.passwordEnabled` 说明是否具有密码能力，不返回哈希。

微信只证明当前 AppID 范围的身份。用户、球队、角色、关联球员均来自既有 `club_users`；客户端提交 `openid`、`role`、`teamId` 等越权参数不会成为权限来源。邀请码是秘密能力凭据，仅保存 SHA-256；管理员创建时仅返回一次明文，重放不恢复原文。

## 2. HTTP 契约

下表路径均以 `/api` 为前缀。请求体字段采用白名单。认证、邀请和绑定响应均 `Cache-Control: no-store`。

| 方法及路径 | 请求与权限 | 结果 |
| --- | --- | --- |
| GET /auth/capabilities | 公开，无请求体 | 仅 `wechat` 布尔值 |
| POST /players/:id/wechat-invites | 同队当前管理员；`{requestId,ttlMs?}` | 201：邀请元数据及一次性返回的 `credential`；相同请求重放为200及 `credentialUnavailable:true` |
| GET /players/:id/wechat-invites | 同队当前管理员；可选 `limit`、`cursor` | `{items,nextCursor,activeInvite}`；默认20、最多50；`activeInvite` 单独返回本范围唯一待处理申请，避免被历史分页埋没；历史按编号分页，不标成“最新”；不含邀请码明文、摘要、openid或session_key |
| POST /players/:id/wechat-invites/:inviteId/approve | 同队当前管理员；`{revision,confirmationCode}` | 校验确认编号后，在同一事务中绑定、复用或创建球员账号并消费邀请 |
| POST /players/:id/wechat-invites/:inviteId/reject | 同队当前管理员；`{revision}` | 拒绝申请；不发会话 |
| POST /players/:id/wechat-invites/:inviteId/revoke | 同队当前管理员；`{revision}` | 撤销 pending/claimed 邀请，不代替解绑 |
| POST /auth/wechat/claim | 原生预认证；`{code,credential,requestId}` | 202：`{id,status,revision,confirmationCode}`；不发业务会话或球员资料 |
| POST /auth/wechat/claim-status | 原生预认证；`{code,inviteId}` | 只返回该已验证微信身份自己的申请状态及确认编号；非本人/不存在统一404 |
| POST /auth/wechat/login | 原生预认证；`{code}` | 只有已批准且当前有效绑定者得到既有 native 会话响应；未绑定403，无自动注册 |
| GET /players/:id/wechat-binding | 同队当前管理员 | `{bound,revision,createdAt?,accountExists,passwordEnabled}`，不返回微信身份 |
| POST /players/:id/wechat-binding/revoke | 同队当前管理员；`{revision}` | 取消当前绑定、待处理邀请和该球员账号全部会话 |

预认证三条 POST 路径严格拒绝 Origin、Cookie、旧 Authorization，要求 `X-Football-Client: native-v1`。保留已验证的微信模拟器 Fetch Metadata 精确特例；该标识不等于认证凭据。允许微信自动 Referer，不扩大其他 API 的匿名或 CORS 范围。预认证及管理邀请请求体上限16 KiB。code、requestId、inviteId、邀请码等在交换前完成类型、长度及格式校验，避免无效输入消耗一次性 code。

管理端可以使用原有受来源保护的 Cookie 会话，或独立 native Bearer。读取请求体后再认证，邀请事务内再次核对当前管理会话、球队、球员状态和版本。过期、旧 revision、重复批准及绑定冲突返回409，客户端须刷新核对，不能盲重试。

### 认领后的人工核对

每次首次成功认领生成随机8位大写十六进制 `confirmationCode`。只有已验证认领者和有权管理该邀请的管理员可查看；管理员须通过既有可信联系渠道向目标球员核对编号，再提交批准。它不是邀请码、登录密码或业务授权，不独立授予权限，也不自动发送消息。认领响应丢失或应用重启时，只要仍是同邀请码及服务端验证的同 AppID/openid，新的 requestId 可以只读恢复既有 claimed 状态和核验码；已认领者也可恢复本人 approved/rejected/revoked/expired 终态，不会覆盖原请求编号、增加版本或重新绑定。不同微信身份、不同 AppID、伪造身份对象或错误邀请码仍拒绝。到期尚未落库的 claimed 只派生返回 expired，不写行或递增版本。历史 approved 不代表现在仍绑定：之后若已解绑或归档，客户端必须重新调用登录接口核验当前资格，不能凭恢复结果授予业务权限。

转发邀请仍可能被别人先认领，确认编号不能替代人工身份判断，更不保证绝对防转发或防社工。旧基础版本已有 claimed 但没有确认编号的申请在新初始化时撤销，必须重新邀请，不自动补码并批准。

## 3. 旧账号、数据库与会话

增量迁移在事务中检查真实表列，记录 `club-wechat-identity-v1`：

- 既有 `club_users.password_enabled` 默认1；旧密码账号和会话继续可用。
- 新微信专用账号是球员角色，`password_enabled=0`；内部用户名和不可用密码占位均随机。不能靠占位值登录。普通创建账号不会覆盖已有微信账号；旧密码重置或本人改密也不会隐式开启它的密码能力。
- 已有同球员密码账号审批时复用原 user ID，密码保持不变。密码重置/本人改密沿用撤销全部会话的语义，但不自动解除微信绑定。
- `club_sessions` 新增来源和绑定版本，所有新签发使用显式列名。native 令牌32字节随机、7天过期、数据库仅存摘要；微信和密码共用签发器及当前球员状态校验。
- 微信身份 `(app_id,openid)` 唯一，同 AppID/user 最多一个有效绑定。绑定版本按同 user/AppID 的全部历史最大值递增，不能解绑旧身份后用旧版本误解绑新身份。
- 微信来源会话每次认证核对当前配置仍启用、AppID匹配、绑定未撤销且版本相同。关闭功能或更换AppID后，旧微信会话不可用；旧密码会话不因此失效。
- 同一 openid 历史属于另一用户时，即使已经解绑，本批也不自动把它转给其他球员。跨球员误绑定纠错/迁移及微信专用账号受控开启密码尚未实现，不能把现有解绑按钮当作跨用户转移工具，也不能直接改库绕过审核。

此迁移不清空用户或比赛资料。测试仅构造匿名临时库，包括重建旧列集合、保留两类原密码会话、重复启动迁移；没有在真实资料库执行验证。

## 4. 归档、解绑与迟到交换

两条归档入口均已接入原事务：球员资料 `savePlayer` 归档，以及 `saveTacticalDesk` 同步移除成员。它们撤销待处理邀请、有效身份绑定及账号全部会话；恢复在队状态不复活旧邀请或绑定。`syncLegacy` 自身导入/更新不是移除入口，移除钩子实际位于 `saveTacticalDesk` 的成员差集处理。

服务端交换前尚不知道 openid，因此采用数据库全局微信认证代次：开始交换时捕获，绑定、解绑、归档时递增，交换完成及签发事务内重新核验。解绑后重绑同身份/不同身份时，之前等待中的交换仍被409拒绝。代次是保守的全局门禁，其他球员的绑定变更也可能要求当前操作重试，换取简单且可验证的安全边界。

审批、绑定、新建账号及邀请消费为同一 SQLite 事务；唯一性或权限失败全部回滚。管理员退出后不能使用旧会话审批。

单次普通退出只撤销给定会话，不代表取消所有匿名 code 交换。客户端仍需以 owner/attempt 门禁处理主动退出、取消登录、隐藏及换账号后的迟到响应；本批不声称已完成该微信前端门禁。

## 5. 限流和部署限制

单进程内存窗口为60秒：IP合计30次、已验证身份30次、单邀请认领10次、管理员60次、球队300次。外呼前检查IP及邀请，交换后再检查验证身份。仅信任既有配置中精确可信代理提供的单一 IP，不能用任意转发头绕过。

限流桶最多10000个，满时拒绝新桶而不驱逐活跃计数；交换同时最多16个，成功或失败释放容量。待处理邀请全局最多1000，列表分页最多50。上游交换保持限时、限响应体，不保存或输出 `session_key`，不透传包含 code、URL、secret 的上游错误。

这些不是分布式或重启后持续限流。多实例必须增加共享限流或明确单进程部署。大量队员同一 Wi-Fi 的密集状态轮询可能触发共享IP限制，客户端应低频、用户主动刷新并尊重429；不能无限轮询或自动重新申请。

## 6. 验证与未完成事项

后端专项覆盖默认关闭、严格原生来源、无效字段交换前拒绝、hash-only邀请/会话、确认编号、申请归属、跨队权限、微信专用密码禁用、旧账号复用、迁移、双归档、事务回滚、绑定版本ABA、解绑/重绑时迟到交换及限流容量。本批与既有后端合计143项测试全部通过、零跳过（明确排除并行 AI 工作的7项）；Web构建通过，虚构值/空环境的 Compose 转发验证通过。独立审核与真实部署验证仍须分别记录，不能仅凭自动测试认定可正式发布。

官方文档入口为 [微信登录凭证校验](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html)。本次尝试直接读取该页面失败；不能把其他平台或搜索摘要当作官方条款核验。provider遵循既有适配契约，全部验证用虚构fetch响应，不代表正式AppID、接口权限、域名或真实微信 code 已验通。

仍待完成：原生小程序邀请/审批/登录及取消保护、实际管理员核对流程、真实配置后的微信交换与真机测试、跨用户纠错恢复、专用账号密码启用流程及生产多实例限流。本批没有真实发送邀请、付费操作或登录生产身份。
