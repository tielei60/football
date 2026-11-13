# 统一界面设计系统

## 修改主题

`app/src/assets/styles/design-tokens.css` 是界面配色的唯一入口。主色由原柏林花园 FC 队徽葡萄紫提亮为柔紫 `--color-brand`，大面积采用 `--color-bg`、`--color-surface`、`--color-sidebar`，冰蓝为 `--color-accent`。正文、次级文字、边框、焦点，以及成功/警告/错误/信息均使用语义令牌。旧工作台变量和 Element Plus 变量在此桥接，不再另设主题。

- 品牌：brand、brand-hover、brand-active、brand-soft、on-brand。
- 阅读与表面：text、text-muted、text-subtle、bg、surface、surface-muted、sidebar。
- 状态：success/warning/danger/info，及对应 soft/border。
- 战术画布：pitch-bg/stripe/line/apron/label；默认球员色另有 home/away/goalkeeper。
- 间距、圆角、阴影：space-_、radius-_、shadow-\*。

`scripts/theme-colors.mjs` 在构建时从同一 CSS 读取品牌/背景色，生成 PWA manifest 与 HTML 主题元数据；调色后重新构建即可，不必另外修改 Vite 色值。

队徽原始图像、球队真实球衣颜色、已存战术及用户选择的画笔色属于业务数据，不随主题覆盖。调色后需复核文字对比度、按钮状态、焦点和浅色球场标记，不把状态仅用颜色表示。

## UiSelect

已全局注册，可将原 `<select>` 改为 `<UiSelect>` 并保留 `<option>` 子节点。动态 `v-for`、空/禁用项、`v-model`、`v-model.number`、`:value` 与 `@change` 均受支持。`:value="null"` 与 `value=""` 不合并；数字、布尔和字符串选项值保持原类型。`@change` 的 `event.target` 是内部原生 select，兼容旧 `.target.value` 处理器。

```vue
<label>比赛归属
  <UiSelect v-model="seasonId">
    <option :value="null">未归属</option>
    <option v-for="season in seasons" :key="season.id" :value="season.id">{{ season.name }}</option>
  </UiSelect>
</label>
```

可见按钮为 `role="combobox"`，选项为 `role="option"`，并有 `aria-controls`、`aria-expanded`、`aria-selected` 和 disabled 语义。支持方向键、Home/End、Enter/Space、Escape、Tab、首字母查找；取消不改变值。隐藏原生 select 只承担 name/form/required 语义，不应作为自动化的用户操作入口。测试通过可见组合框和选项点选；`data-value` 是用于断言的字符串表示，不改变业务类型。

下拉定位在视口内，在原生 dialog 中时挂载到当前 dialog，避免浮层落到模态层背后。选项更新、外部值变化、禁用、卸载均清理对应状态/监听。

## UiDialog 与确认

全局 `UiDialog` 支持 `v-model`、`title`、`description`、`closeOnBackdrop`，默认内容与 footer 插槽。使用原生 dialog 的模态焦点约束，视觉来自统一令牌；Escape/关闭会更新 model 为 false，关闭还原原焦点。默认外点不关闭，避免意外丢失表单。

```ts
import { confirmAction } from "@/components/ui/confirmAction";
if (
  !(await confirmAction("此操作将移除记录，确认继续？", {
    title: "移除记录",
    confirmText: "确认移除",
    danger: true,
  }))
)
  return;
```

确认函数返回 Promise<boolean>。调用链必须 async/await，不能直接用 Promise 充当布尔判断。默认取消获得焦点，Escape 与关闭均等于取消；重复请求排队，不同时堆叠多个弹窗。

原生系统文件选择器和日期输入的系统辅助面板不属于业务皮肤；输入表面、文件按钮及焦点统一设计，不改变系统权限或文件访问行为。

成功切换路由（完整路径改变）时，路由层调用 `cancelAllConfirmations()`：先原子清空当前确认与队列，再将所有旧请求解析为 `false`，防止离开页面后执行旧删除/清空操作。失败或取消的导航不清空确认，因此离页保护仍可正常等待用户回答。
