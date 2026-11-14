# 微信原生输入聚焦复核清单

## 范围与证据边界

2026-11-13 静态盘点：25 个路由，16 个页面含输入，另有 1 个共享业务弹框。共 **34 个模板实例：30 个 input、4 个 textarea**。列表输入须逐个抽查不同数据行；模板计数不等于渲染节点数。

本表记录**本轮实际聚焦复核**，未覆盖的组合仍单独保留边界。未聚焦截图、模板编译、mock 单元测试不能证明光标位置正确。实测结果应由实际操作人员填写并附证据，不因 CSS 修改自动标为通过。

## 真实聚焦验收步骤

每一行分别在空值和已有值测试，375 与 320 宽度至少覆盖每一种布局/类型：
1. 实际点击聚焦并弹出键盘，观察 caret、placeholder、已有文本基线一致，不被边框裁切。
2. 输入、删除、中间插入及长文本横向滚动；中文输入检查候选组合，数字检查 0 与留空，密码只用虚构测试串。
3. 失焦再聚焦、切换邻近字段，确认内容和光标不异常跳转；只在草稿操作，不提交测试密码/业务修改。
4. textarea 检查换行、多行内滚动、auto-height 标签；键盘抬起不遮住当前行。
5. 弹框检查空/已有值、普通/密码模式，确认和取消、输入期间 toast/加载状态不重置草稿。
6. 表单 busy/disabled、历史只读、权限不满足时不得强行开启输入；场地自动关联时地点输入禁用属预期。

## 静态审查结论（不是焦点实测结论）

- 页面未指定 cursor/selection-start/selection-end，也没有按每次输入强制 focus。共享弹框仅新 modal id 时初始化 inputValue/inputFocus。
- 普通表单通过精确字段路径原样保存 e.detail.value；数字转换在提交校验阶段，未知空值与 0 保持区分。名单循环使用稳定 playerId。
- 管理球员搜索原每键 trim 后回写会吞尾空格；已最小修复为保留原输入，仅筛选时 trim，匹配语义不变。
- 搜索会更新 visible 列表，但输入在列表外，不随搜索结果卸载。编辑页的加载/错误/权限变化可卸载输入，这是安全行为，不能在后台刷新时误清草稿。
- 用户反馈 caret 比 placeholder 下偏与原生控件纵向 padding/line-height 关系需要实际 A/B；旧的“高度容纳行高+padding”算式不足以验证原生 caret，不能作为通过依据。
- 业务弹框暂无页面默认 editable 调用入口，但共享组件支持该模式，仍需用不提交业务数据的测试弹框聚焦验收。

## 逐实例实际聚焦记录（375 × 812）

| # | 模板 | 定位 / 字段 | 类型 | value 绑定 | 输入 handler | 样式来源 | 焦点 / 键盘显式属性 | 375 聚焦证据 / 空有值边界 |
|---|---|---|---|---|---|---|---|---|
| 1 | components/business-dialog/index.wxml | {{inputValue}} | text / password | {{inputValue}} | input | 隔离组件 .dialog-input | focus={{inputFocus}}；confirm-type=done；adjust-position=true | 已实际聚焦：普通空起输入、中间移动 caret 后确认；密码已有虚构值后取消；组件恢复；其余空/有值组合未全测 |
| 2 | pages/login/index.wxml | {{username}} | text | {{username}} | username | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：空起输入虚构账号，aXb 中间插入正常；其余空/有值组合未全测 |
| 3 | pages/login/index.wxml | {{password}} | text / password | {{password}} | password | app.wxss .input | confirm-type=done | 已实际聚焦：空起输入虚构密码后 caret 正常；未提交；其余空/有值组合未全测 |
| 4 | pages/manage-player/index.wxml | name | text | {{form.name}} | input | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：已有姓名，Left 移动 caret 正常；其余空/有值组合未全测 |
| 5 | pages/manage-player/index.wxml | number | number | {{form.number}} | input | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：已有号码 9，Left caret 正常；其余空/有值组合未全测 |
| 6 | pages/manage-player/index.wxml | note | textarea | {{form.note}} | input | 页面 WXSS / 全局 textarea | 默认键盘/焦点行为 | 已实际聚焦：已有备注末行，Left caret 正常；其余空/有值组合未全测 |
| 7 | pages/manage-player/index.wxml | username | text | {{username}} | accountInput | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：未开通账号展开，空起输入虚构账号；未提交；其余空/有值组合未全测 |
| 8 | pages/manage-player/index.wxml | password | text / password | {{password}} | accountInput | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：空起输入虚构密码，caret 正常；未提交；其余空/有值组合未全测 |
| 9 | pages/manage-players/index.wxml | {{search}} | text | {{search}} | search | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：空起粘贴“ 陈越 ”，空格保留且正确筛选，Left caret 正常；其余空/有值组合未全测 |
| 10 | pages/manage-season/index.wxml | name | text | {{form.name}} | input | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：已有赛季名称，Left caret 正常；其余空/有值组合未全测 |
| 11 | pages/manage-team/index.wxml | name | text | {{form.name}} | input | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：已有球队名称，Left caret 正常；其余空/有值组合未全测 |
| 12 | pages/manage-venue/index.wxml | name | text | {{form.name}} | input | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：已有球场名称，Left caret 正常；其余空/有值组合未全测 |
| 13 | pages/manage-venue/index.wxml | address | text | {{form.address}} | input | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：已有地址，Left caret 正常；其余空/有值组合未全测 |
| 14 | pages/match-edit/index.wxml | opponent | text | {{form.opponent}} | input | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：已有对手名称，Left caret 正常；其余空/有值组合未全测 |
| 15 | pages/match-edit/index.wxml | competition | text | {{form.competition}} | input | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：已有赛事名称，Left caret 正常；其余空/有值组合未全测 |
| 16 | pages/match-edit/index.wxml | location | text | {{form.location}} | input | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：已有地点，Left caret 正常；其余空/有值组合未全测 |
| 17 | pages/match-edit/index.wxml | homeScore | number | {{form.homeScore}} | input | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：A/B 空值 caret 可见；12 中间插入 3 得 132，caret 正常；其余空/有值组合未全测 |
| 18 | pages/match-edit/index.wxml | awayScore | number | {{form.awayScore}} | input | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：已有客队比分 1，Left caret 正常；其余空/有值组合未全测 |
| 19 | pages/match-edit/index.wxml | analysis | textarea | {{form.analysis}} | input | 页面 WXSS / 全局 textarea | 默认键盘/焦点行为 | 已实际聚焦：A/B 复盘末行换行、粘贴中文，caret 正常；其余空/有值组合未全测 |
| 20 | pages/match-media/index.wxml | notice | textarea | {{notice}} | input | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：空起粘贴两行中文须知，Left caret 正常；其余空/有值组合未全测 |
| 21 | pages/match-media/index.wxml | caption | text | {{caption}} | input | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：空起输入虚构照片说明，caret 正常；其余空/有值组合未全测 |
| 22 | pages/match-roster/index.wxml | goals | number | {{item.goals}} | input | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：已有进球 2，实际聚焦 caret 正常；其余空/有值组合未全测 |
| 23 | pages/match-roster/index.wxml | assists | number | {{item.assists}} | input | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：两行助攻 0 / 1，实际聚焦 caret 正常；其余空/有值组合未全测 |
| 24 | pages/me/index.wxml | currentPassword | text / password | {{currentPassword}} | input | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：空起输入虚构当前密码，caret 正常；收起未提交；其余空/有值组合未全测 |
| 25 | pages/me/index.wxml | newPassword | text / password | {{newPassword}} | input | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：空起输入虚构新密码，caret 正常；收起未提交；其余空/有值组合未全测 |
| 26 | pages/players/index.wxml | {{search}} | text | {{search}} | search | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：空起搜索林远，Left caret 正常；其余空/有值组合未全测 |
| 27 | pages/season-roster/index.wxml | {{item.number}} | number | {{item.number}} | number | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：两行赛季号码 1 / 4，已有值 Left caret 正常；其余空/有值组合未全测 |
| 28 | pages/tactic-board/index.wxml | editor-label | text | {{label}} | property | 页面 WXSS input | 默认键盘/焦点行为 | 已实际聚焦：属性空起输入测试文字，Left caret 正常；取消；其余空/有值组合未全测 |
| 29 | pages/tactic-compose/index.wxml | stage-title | text | {{stageTitle}} | input | 页面 WXSS input | 默认键盘/焦点行为 | 已实际聚焦：已有阶段标题，Left caret 正常；其余空/有值组合未全测 |
| 30 | pages/tactic-compose/index.wxml | piece-label | text | {{label}} | input | 页面 WXSS input | 默认键盘/焦点行为 | 已实际聚焦：已有演示球员名称，Left caret 正常；其余空/有值组合未全测 |
| 31 | pages/tactic-compose/index.wxml | piece-number | number | {{shirtNumber}} | input | 页面 WXSS input | 默认键盘/焦点行为 | 已实际聚焦：已有演示号码 1，Left caret 正常；其余空/有值组合未全测 |
| 32 | pages/tactic-setup/index.wxml | setup-title | text | {{title}} | input | 页面 WXSS input | 默认键盘/焦点行为 | 已实际聚焦：已有战术标题，Left caret 正常；其余空/有值组合未全测 |
| 33 | pages/tactic-setup/index.wxml | setup-tags | textarea | {{tagsText}} | input | 页面 WXSS textarea | ；auto-height=true | 已实际聚焦：标签末尾 Return 追加中文为四行，自动增高且 Left caret 正常；其余空/有值组合未全测 |
| 34 | pages/tactics/index.wxml | {{search}} | text | {{search}} | search | app.wxss .input | 默认键盘/焦点行为 | 已实际聚焦：空起搜索“原生”，Left caret 正常；其余空/有值组合未全测 |

## 无原生输入的路由

pages/home/index, pages/schedule/index, pages/statistics/index, pages/match-detail/index, pages/player-detail/index, pages/manage-seasons/index, pages/manage-venues/index, pages/tactic-transfer/index, pages/tactic-export/index。仍检查其弹框组件，但不伪造页面输入实例。

## 已落盘的单行样式修正（未等同实测通过）

仅消除原生 input 的纵向 padding，保留高度、横向留白和既有行高：

| 覆盖 | 最终选择器 | padding |
|---|---|---|
| 通用单行输入 | app.wxss `input.input` | 0 24rpx |
| 赛季球员号码 | season-roster `.number input` | 0 8rpx |
| 战术标注文字 | tactic-board `.properties input` | 0 12rpx |
| 阶段与球员属性 | tactic-compose `input` | 0 12rpx |
| 战术名称 | tactic-setup `.card input` | 0 14rpx |
| 隔离业务弹框输入 | business-dialog `.dialog-input` | 0 22rpx |

4 处 textarea 基线未显示相同问题，本轮保留其原结构、样式和 auto-height；不把单行控件规则套给多行输入。回归只验证以上样式契约和输入数据行为，375 全部模板实例已逐项实际聚焦；320 覆盖如下六套样式代表，不等于每字段/每状态/每设备全覆盖。

## 320 × 640 代表性聚焦复核

| 样式路径 | 实际覆盖 | 结果 |
|---|---|---|
| 全局单行 input | #2 账号、#3 密码空起输入虚构串；#26 搜索空起输入并清空 | caret 可见且对齐 |
| 赛季号码 | #27 已有号码 1 | caret 可见且对齐 |
| 战术画布属性 | #28 空起测试文字后取消 | caret 可见且对齐 |
| 动画编排 | #29 已有阶段名称 | caret 可见且对齐 |
| 阵型与元数据 | #32 已有标题；#33 标签 Return 新增中文行 | caret 对齐；多行自动增高正常 |
| 隔离弹框 | #1 预填测试文字，聚焦后实际取消 | caret 可见且对齐；恢复组件 |

## 实测方式、恢复与未验证边界

- 375 × 812 全部 34 个模板实例均实际点击聚焦，操作员在 CUA 即时帧观察到 caret 与文本对齐；**不表示每个字段的空值、已有值、长文本全部组合均已覆盖**。具体覆盖见逐行记录。
- 官方 PNG 截图可能漏掉光标闪烁帧，因此不以未显示 caret 的文件冒充可见 caret 证据。静态截图仅辅助记录布局。
- 四类 textarea 已覆盖：球员备注末行、比赛复盘换行、比赛须知两行中文、战术标签自动增高；未把单行 padding 规则套到 textarea。
- 弹框以临时测试 bridge 调用组件 present，不调用业务 API。普通输入实际确认，密码模式实际取消；随后 clearInput、present(null)、恢复原 bridge 并移除测试引用。密码仅虚构测试串，未提交登录/重置。
- 所有表单草稿离页丢弃未保存；搜索清空；最终恢复 375 × 812 首页。
- **尚未验证：手机真机软键盘抬起/遮挡、中文输入法候选组合、不同系统和微信版本。** 本轮使用开发者工具硬件键盘及中文粘贴，不能替代真机 IME 验收。
- 代码回归：255 项通过；官方模板 111 次虚拟渲染通过。二者验证代码/模板，不替代以上真实聚焦观察。
