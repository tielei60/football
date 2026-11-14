# 原生小程序文字层级：第 1 批 7 页

## 范围与依据
实际查看 `docs/research/screenshots/dazhi-{activity,registration-list,teams,team-card}.png` 四张参考图，借鉴姓名、日期地点、报名数量比辅助来源/说明更醒目的信息层级，不复制头像、球队资料、橙色、布局或额外功能。

依据 `wechat-typography-plan.md`，本批仅修改 home、schedule、players、statistics、me、login、player-detail 局部文字样式；必要 WXML 只补语义 class。页面节点/列数/条件/绑定/权限/数据均不变。未改 app.wxss、共享组件、JS、Canvas 或其他页面。原有重复 WXSS 合并为最终有效声明，避免继续堆叠覆盖。

## 逐页选择器与调整
| 页面 | 选择器 | 实施 |
|---|---|---|
| 首页 | `.hero .title/.subtitle`、`.hero-metrics/.hero-number` | 队名36rpx/650，身份20→24rpx，取消额外字距；数字38rpx/650，单位22→24rpx |
| 首页 | `.match-title/.match-time/.card .muted.match-place`、`.recent-name/.card .score/.section-title` | 对手32rpx/600；时间28rpx/500深色；地点26rpx；近期队名29rpx/600，比分36rpx/650；小节28rpx/600 |
| 赛程 | `.page>.between .title/.section-title/.card .match-name/.card .muted.match-time` | 标题34rpx/650，月份26rpx/600，对手30rpx/600，时间26rpx/500深色 |
| 赛程 | `.card .muted/.tag/.link/.score` | 辅助25rpx/1.6，状态24rpx/500，报名23→25rpx，比分34rpx/650 |
| 球员 | `.page>.title/.subtitle/.card .bold/.card .muted/.jersey` | 标题34rpx/650；辅助24rpx；姓名29→30rpx/600；位置24→25rpx/1.6；号码34→32rpx/600紫色 |
| 统计 | `.scope-title/.opponent-name/.rank-row .bold/.rank/.rank-value` | 范围/对手/姓名29rpx/600；名次26rpx/500使用muted，不再浅紫；成绩34rpx/650 |
| 统计 | `.metric .number/.metric .label/.card .muted/.hint/.score-summary` | 数字38rpx/650，单位/覆盖率/比分完整度25rpx，说明1.6行高，保留未知不计零 |
| 我的 | `.card.row .title/.team-name/.card .tag` | 姓名32rpx/650，球队26rpx/1.6，角色24rpx/500 |
| 我的 | `.metric .label/.metric .number/.section-title/.account-heading/.hint/.error` | 单位22→25rpx；数字34rpx/650；小节/密码标题28rpx/600；辅助24rpx；错误26rpx/500，危险色不变 |
| 登录 | `.login>.title/.login>.subtitle/.field-label/.error/.login .hint` | 标题40→38rpx/650，说明25rpx/1.65，字段标签26rpx/500，错误26rpx/500，辅助24rpx |
| 球员详情 | `.card .title/.player-meta/.section-title/.metric .label/.metric .number/.foot-value/.hint/.tag` | 姓名34rpx/650；号码位置26rpx；小节28rpx/600；单位25rpx；数字38rpx/650；惯用脚值28rpx；覆盖率24→25rpx/1.65，报名状态24rpx |

为保护已验证控件几何，不修改输入字体、padding、height、line-height，也不调整 tab/picker/button 字号。计划中控件字号统一另待测量，不能以本批宣称已完成。不加全局字体 token，避免其他18页未经验证随之变化。

## 小屏与静态保护
24/25/26/28rpx内容文字在分别低于375/360/346.154/321.429px时用已支持的媒体规则设置12px下限，只选择内容文字，不覆盖输入、按钮、下拉、tab、画布。宽屏保留rpx换算，不使用CSS max()。

`typography-batch1.test.cjs` 与精简 baseline 保存修改前模板（忽略class）的SHA-256及原有非字体几何声明，检查节点/事件/绑定不变、非字体布局不变、小屏规则不覆盖控件及七页具体层级。静态8项通过；全套检查结果见交付报告。这些约束不是原生最终computed style或可读性/点击域验证。

## 已完成的真实截图审核

新版代码在微信开发者工具 375px 视口采集七页真实截图，由唯一 UI 操作者操作，审阅者只读查看。home/schedule/player-detail、me/login、players/statistics 分组完成审核，当前可见正常态未发现阻断级排版问题：

- 首页：队名、身份辅助、下一场对手/时间/地点层级清楚，主按钮无挤压；近期赛果名称与比分分列，未知比分保留 `0 : —`。
- 赛程：标题与创建比赛按钮对齐，年月、对手、时间及报名行可读；地点与报名未碰撞，卡片边框完整。
- 球员列表、统计：本轮审阅者已检查新版375正常态截图，未报告阻断问题；不据此推断超长姓名或大数字场景。
- 我的、登录：本轮审阅者已检查新版375正常态截图，未报告阻断问题；截图不代替密码输入、登录或退出流程验收。
- 球员详情：姓名/号码位置/在队主次明确，三列统计单位完整，覆盖率自然换行，报名四标签完整。

短页top/middle/bottom重复属于页面没有更多可滚内容，未误判为滚动失败。上述结论只针对已采集的375正常态像素，不是全部业务、所有状态或真机通过。

## 仍待验证

- 设备入口未成功打开，320/430及其他宽度仍待验；球员身份变体、超长名称/地址、大数字和错误态未由本批截图覆盖。
- 官方元素输入已真实执行搜索“林”，结果为林远；CUA 聚焦未生效且没有捕获可见 caret，因此光标位置未验，密码输入未验；账户操作的功能验收也不能由正常态截图替代。
- 后续按实际测量决定是否调整控件字体，保持输入既有几何，不因本批截图正常而扩大结论。

本批文档更新未操作UI、修改演练数据、提交或发布。静态测试/模板渲染与上述真实截图审核分别记录，不作全站通过结论。
