# AI私有来源素材领域基础（默认关闭、未接线）

## 边界

新增 `server/player-ai-assets.mjs`，仅保存私有来源图片，不是候选生成模块。未接HTTP、现有club-store、小程序、AI任务worker或供应商；无外部请求、密钥、费用或真实照片。默认关闭时不能建表或执行操作。只有调用方显式提供SQLite连接、启用标志和授权/保留策略才可初始化。

不改变现有球员相册权限或解码行为，不写公开相册、头像、比赛、候选或采用记录。来源和生成候选不能混同；后续候选写入、采用、回调及公开来源标记仍未实现。

## 内部契约

可信服务层注入同步 `authorize(actor, scope)` 和 `resolveConsent(consentId)`。这不是客户端接口：不能从请求体接受授权函数或把其结果当用户声明。

- authorize必须核验当前会话、有效管理员、目标球员、球队及**原上传者**，返回精确匹配的teamId/playerId/requesterId、role=admin、active=true和正整数revision。其他同队管理员不自动具有访问权。
- resolveConsent须返回对应球队/球员/上传者、purpose=`private-ai-source`、active、expiresAt和正整数revision。此处仅代表本系统私有来源处理授权，不授予任何供应商传输或计费权限。
- 两依赖必须同步；Promise不能truthy绕过。
- revision必须由未来真实授权层在撤权/恢复、作用范围变更时单调递增。现有认证/同意系统尚未提供此专用契约，不宣称已接线。图片读操作每次重新核验当前权限与有效同意；解码前后、就绪读取/引用及同请求重放都比较原授权revision。撤回再以新revision恢复，不会自动恢复旧来源访问；仍可核对状态并删除。
- maxLifetimeMs必须显式提供，最多30天；上传到期时间还不得晚于同意有效期。这是技术上限，不是已批准的法律保留政策。

## 上传、核对、读取和删除

`upload` 接受内部scope、requestId、consentId、expiresAt及dataUrl。事务先登记processing及授权版本，再复用 `sanitizePlayerPhoto` 完整解码、清除EXIF/ICC并重新编码。具体输入2MiB、静态PNG/JPEG、像素/尺寸、资源并发/超时及透明白底策略继承已有安全解码器，本模块不另设宽松分支。

解码完成重新授权，在同一事务核验仍processing、原对象revision、原授权revision及未过期后写ready。原始图片字节不落库，只持清洗后的JPEG。无公开URL，普通元数据不含图片、授权ID或内容摘要。

同scope/requestId的ready同载荷返回原元数据；不同载荷、processing、failed、deleted均拒绝重提解码。`inspectRequest` 仅向原上传者返回opaque对象ID、status、revision，便于丢响应核对或清理，不返回图片/尺寸/他人资料。进程崩溃留下processing时不自动重做，应核对后删除并使用新requestId。

`read` 与 `reference` 都重验当前权限、同意、ready、到期时间及指定revision。reference只返回已核验私有对象归属与版本，不能当作永久授权；未来使用前需再次核验。返回的dataUrl仅为内部鉴权内容，不是公开链接。

`remove` 可在同意撤回或对象过期后由仍有权限的上传者执行；原上传者账号失效时不授权其继续操作，后台合规清理仍待实现。删除递增revision并擦除图片、摘要及图片元数据，保留最小对象/请求/授权引用墓碑。同request重放不能复活，进行中的旧解码CAS失败不覆盖墓碑。失败只留最小核对记录，不留图片内容或payload摘要。

## 删除和到期的限制

当前到期即拒读/引用，但没有后台定时清除；清理需要显式remove。没有实现撤回全部授权的批量删除、文件备份清理或磁盘加密，也没有清除已合法读取到其他客户端的副本。SQLite清空字段不保证底层页、WAL或备份被物理擦除，不能声称彻底删除。后续开放上传前必须核定生产配额、补到期清理、存储/备份政策及前端会话缓存撤销。

## 匿名验证

`node --test server/player-ai-assets.test.mjs` 当前10项通过，自动纳入既有server测试集合。

全部为合成图片、内存数据库，无真实身份/照片或外部调用。覆盖默认禁用不建表、真实解码和EXIF清除、上传者权限、元数据幂等、引用revision、解码在途删除、撤权/授权版本变化/到期、迟到写入拒绝、同request并发不重复、失败后清理重建、错误链接/超限/异步依赖拒绝。

竞态测试确实在upload已登记processing并await解码期间执行remove或更改授权后再等待结果；没有通过替换解码器跳过真实图片验证。未覆盖多进程压力、磁盘断电、真实授权层、HTTP/小程序、真实照片或供应商生成。

## 配额补强

策略必须显式提供maxObjectsPerUploader（1至1000）和maxStoredBytes（至少2MiB的安全整数）。按球队+上传者计算所有非deleted对象，含过期未删及failed的对象槽；processing每个在BEGIN IMMEDIATE登记事务中预留2MiB，ready改按实际清洗后字节计算。新上传只有可容纳完整2MiB预留才允许，返回429不会登记额外对象。删除释放占额，不自动清理墓碑；长期元数据保留政策仍待接入层落实。maxStoredBytes指解码后图片二进制量，不是SQLite物理文件大小，base64存储/索引/WAL会有额外开销。

新增测试覆盖就绪后授权版本变化拒绝读取/引用/重放、仍可删除；processing及ready字节预留/对象数上限与删除释放；跨team/player/requester/purpose错误同意及异步resolveConsent拒绝且零记录。
