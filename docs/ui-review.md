# 浅紫界面改版：独立代码审查

## 范围与证据边界

针对 `720bbd6` 原型基线上的真实应用改版工作树做独立检查，不把原型、旧提交 CI 或静态阅读等同于最终可用性验收。审查员仅修改本报告，未修改业务源码、测试或远端；浏览器人工演练、截图和最终同提交 CI 由整合负责人另行追加。

本轮阅读范围：

- 集中语义颜色令牌、旧样式别名、状态/焦点/表格/空状态及 Element Plus 配色接合。
- `UiSelect` 的数值、布尔与 null 绑定，隐藏原生表单桥、标签、键盘与焦点、动态选项、弹层定位及 portal 事件。
- `UiDialog`、全局确认队列、卸载及导航竞态。
- 比赛信息与名单独立脏状态、分别保存、撤销、离开保护以及分区导航。
- 原战术工作台、球员弹窗、动画及历史数据呈现；导出时将计算后的颜色内联到克隆 SVG，保留原始用户配色及几何。
- 路由与管理/球员界面接合。此项不替代完整后端权限回归。

## 发现与修复复核

### 1. 分区锚点导航可能丢失比赛草稿

`ClubLayout.vue` 曾用 `$route.fullPath` 作为 RouterView key；新增比赛分区链接改变 hash，因此同一比赛组件可能被重新创建。`onBeforeRouteLeave` 不处理同一 route record 的 hash 更新，未保存的信息和名单会被重新加载覆盖。

独立使用实际 Vue Router 的 memory history 复现：`/club/matches/7` 到 `#match-roster` 时 fullPath 改变，leave guard 调用 0 次、update guard 调用 1 次。

**代码修复已复核：** key 改为 `$route.path`。分区 hash 不重建组件，不同比赛路径仍能重新加载。真实页面填写两份草稿并逐个点击分区的浏览器结果待最终记录。

### 2. 球员角色菜单被外部点击提前关闭

球员弹窗使用 `useClickOutside` 的 document pointerdown 冒泡监听；新 `UiSelect` 菜单 teleport 到 body。选项原先只 preventDefault，没有停止冒泡，因此点菜单会先关闭并卸载球员弹窗，后续 click 无法完成选择。

**代码修复已复核：** `UiSelect` listbox 增加 `@pointerdown.stop`，选项保留 `@pointerdown.prevent`。菜单内部事件不再到达该外部点击监听；控件自身的 document capture 监听仍识别所属菜单，真正的外部点击继续正常关闭。实际鼠标选择球员角色的浏览器回归待最终记录。

### 3. 离开页面后仍可确认旧操作

全局确认 host 不随战术页卸载；旧调用在 await 后仍可能执行 `newBoard()` 或 `deleteTactic()`。独立运行实际 `confirmAction.ts` 与 Vue Router，确认导航到 `/club` 后 pending 仍存在，接受确认会继续执行旧操作。

**代码修复已复核：** `cancelAllConfirmations()` 先清空 active 与队列，再统一 resolve(false)；router 的 afterEach 仅在实际成功导航且 fullPath 改变后取消，失败导航不取消，也不会在离开 guard 等待答案之前误取消。

修复后独立执行 10 个 Node 断言，验证当前与排队请求均取消、迟到 answer 不复活旧请求、失败导航保留确认、正常离开 guard 可确认并完成导航，全部通过。

### 未升级为缺陷的怀疑

检查过“已卸载弹窗的迟到 close 是否回答下一个确认”。当前 Vue runtime 的 emit 首先检查 `instance.isUnmounted`；正常卸载后的旧 emit 被忽略。未取得实际反例，因此不将此猜测写成已发现缺陷，不据此扩展架构。

## 实际执行的检查

- 本轮独立运行 `npm run test:unit`：22 项通过，0 失败。
- 独立运行 `npx vue-tsc --noEmit --project tsconfig.app.json`：通过；导航取消修复后再次运行通过。
- 独立运行 `git diff --check`：通过。
- Vue Router hash guard 行为复现，以及修复后的确认导航 10 项断言：通过。
- 未启动浏览器，未运行最终完整 Playwright 或 Docker；上述代码修复复核不代表这些环境已通过。

## 最终整合验证

由整合负责人补充最终提交、真实浏览器覆盖、截图、完整业务回归和 CI 结果，并准确保留未验证项。
