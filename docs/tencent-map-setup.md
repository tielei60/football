# 腾讯地图接入与坐标兼容

本轮选择 **腾讯 JavaScript API GL**，用于国内球场的地图显示、缩放、点击选点。依据腾讯官方基础接入文档使用 `https://map.qq.com/api/gljs?v=1.exp&key=...`；不使用体验 Key、非官方瓦片或 SDK 镜像，不调用定位、地址搜索、逆地理编码，也不配置服务端签名 SK。

## 为什么选腾讯

- 腾讯基础 GL 接入使用浏览器 Key，适合现阶段的球场点选，且 GCJ-02 便于未来微信场景明确对接。现阶段并没有开发微信登录或小程序。
- 高德 JS API 2.0 新 Key 另需安全码，官方生产建议 `serviceHost` 服务端代理注入 `jscode`，多一层代理及秘密管理。本次不为了简单点选新增这层配置。
- 百度 GL 同样可用，但涉及 BD-09，会增加第三种坐标契约。本次不混用多个供应商。

## 用户需要准备的配置

1. 在自己的腾讯位置服务账号中创建本项目独立 Key，开通 **JavaScript API GL**。账号注册、实名、服务条款和费用/商业授权由账号所有者确认，本项目不会替你办理。
2. 在控制台按实际产品能力配置正式网站来源限制、配额及用量告警。不要照抄任意示例 Key、全放开来源或开通不需要的 WebService 产品。
3. 将浏览器 Key 放在服务端运行环境的 `FOOTBALL_TENCENT_MAP_KEY`，不要写进源码、截图、日志或 GitHub。**不要填 SK、服务端签名秘密或高德安全码。**
4. 重启应用。无需重新构建前端。管理员进入“球场管理”，点击“打开地图选点”后才读取配置及加载腾讯 SDK。

Docker：复制仓库 `.env.example` 为自己本地的 `.env`，填入对应变量后执行 `docker compose up -d`。`.env` 已被 Git 忽略。非 Docker：通过进程管理器注入变量；普通 `npm run start` 不会自动读取 `.env`。本地演练可将变量注入 `npm run demo`，仍使用新建的隔离演练库。

空变量是安全默认值：未配置时，页面说明缺少 Key，不加载任何地图 SDK；球场地址、手动坐标和其他业务仍可使用。不要为了演练假造可用 Key 或把测试用模拟 SDK 当成线上腾讯服务。

### 浏览器 Key 不是隐藏秘密

JS SDK 使用的 Key 必须出现在浏览器请求中，已登录管理员可见，不能靠“从后端返回”使它保密。`GET /api/maps/config` 仅管理员可读、禁止缓存，且不返回其他环境变量；这只是访问控制，不保证别人无法提取或滥用公开 Key。

腾讯已核实的“域名白名单”说明明确针对浏览器 JSONP 的 WebServiceAPI，**不能据此宣称所有 GL 地图请求都被同一白名单防盗用**。GL 的来源限制以用户控制台实际支持范围和官方说明为准；应使用独立 Key、最小权限和配额管理。没有登录用户控制台核实账户额度，不能承诺永久免费或给出该账户的商业价格。

## 坐标与旧数据

- 球场增加 `coordinateSystem: wgs84 | gcj02`。旧球场迁移为 wgs84，坐标原值、revision 不变。
- 旧比赛场地快照缺标签时，仅在 API 响应中补 wgs84；不改数据库中原始快照 JSON，普通比赛保存也不会重新捕获场地。
- 现存 WGS84 打开腾讯地图时使用全国默认视野，不把 WGS84 原值错误地放在 GCJ-02 底图，也不使用未经核验的近似转换。打开/关闭本身不会修改球场。
- 用户主动在地图重新点选后，草稿变成 GCJ-02；点击“保存球场”才写库。已有比赛仍保留原快照。
- 手动输入保留 WGS84 与 GCJ-02 选择。有坐标时切换会要求确认清空，取消则原值和坐标系都不变，绝不只换标签。
- 旧 WGS84 API 客户端可省略新标签；已有 GCJ-02 记录若更改坐标却省略标签会被拒绝，避免旧客户端把它当 WGS84 写入。
- 比赛详情展示坐标及坐标系，可选中复制。没有继续使用 OpenStreetMap 外链，也没有使用未经正式配置的腾讯 URI `referer`。腾讯 URI 文档有 GPS/腾讯坐标显示转换，但本轮不代填来源标识或开通额外服务。

## 网络、权限和降级

官方 SDK 只在显式打开地图且服务器配置 Key 后加载。应用不向地图传球场名称、备注、球员资料，不自动获取设备定位。第三方 SDK 和底图请求仍会向腾讯提供常规网络信息与地图视野，按腾讯自己的服务条款处理；不应将私人住址当作公开球队场地。

脚本加载和底图成功是两步：SDK 加载后还需收到官方 `tilesloaded` 事件。脚本错误、初始化异常、图形上下文丢失和有界超时均显示降级提示；“加载失败”可能来自网络、权限、Key、来源限制或配额，不能仅凭超时断言具体原因。关闭、切换编辑对象及重试会释放地图实例和监听，迟到结果不写另一球场。无地图时继续保存地址、手填坐标或留空。

## 验证范围

迁移、权限、版本冲突、快照保留、坏输入和无配置路径用隔离 SQLite / HTTP 验证；浏览器回归拦截所有外部请求，模拟官方 SDK 的 documented events 验证点选、清空、重试和生命周期，**不是腾讯真实在线服务验收**。生产 Key、实际域名限制、真实底图及账户配额，须在所有者完成合法配置后联调；本轮未申请 Key、注册账号、接受协议或部署。

## 官方资料

- [腾讯 GL 基础接入](https://lbs.qq.com/webApi/javascriptGL/glGuide/glBasic)
- [地图实例与事件](https://lbs.qq.com/webApi/javascriptGL/glDoc/docIndexMap/)
- [点标注](https://lbs.qq.com/webApi/javascriptGL/glDoc/glDocMarker)
- [坐标类](https://lbs.qq.com/webApi/javascriptGL/glDoc/glDocClass)
- [WebService Key 安全说明及适用范围](https://lbs.qq.com/faq/serverFaq/webServiceKey)
- [腾讯 URI 地点标注](https://lbs.qq.com/webApi/uriV1/uriGuide/uriWebMarker)
- [高德 JS API 安全码及 serviceHost](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)
- [百度 GL 坐标说明](https://lbs.baidu.com/docs/jsapi?title=jspopularGL%2Fguide%2Fcoorinfo)
