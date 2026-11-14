# 原生战术新建与结果核对

本批解决空战术库只能导入、不能直接新建的入口缺口。它不读取或自动带入柏林花园来源名单。实际界面验收另记，不能以接口测试宣称完整手机流程通过。

## 兼容与权限

沿用现有战术资源属于原球队 `team_id=1` 的边界，不宣称已有多球队战术隔离存储。以下目录与新建回执仅供该队当前有效管理员会话；客户端不能指定账户或球队。原有 `POST /api/tactics` 不带 `requestId` 时保持旧网页行为，包括旧预设去重。新原生页面必须带请求编号。

- `GET /api/tactic-formations` 返回 `{formations:[...]}`，逐项包含 `playerCount/id/name/category/spots`，复用既有服务器目录及其网页坐标一致性测试。人数包含门将，支持5/6/7/8/9/11人制。
- `POST /api/tactics` 请求 `{requestId,tactic,note}`。成功返回原有战术对象，编号字段为 `tacticId`。`requestId` 在请求顶层，不能混入战术、画布或导出资料。
- `GET /api/tactic-create-receipts?requestId=...` 返回 `{requestId,tacticId,available}`；只核对同队同管理员已受理的新建，不返回其它账号资料。未找到返回404。除一个 `requestId` 外不接受其它查询字段。

编号为8至128位字母、数字、下划线或连字符。新建模式只接受顶层 `requestId/tactic/note`；不接受客户端身份字段。最小空白战术示例（全部虚构、不关联任何实际球员）：

```json
{
  "requestId": "example-create-unique-001",
  "note": "初始空白",
  "tactic": {
    "title": "虚构演练·空白战术",
    "tags": [],
    "favorite": false,
    "formationName": null,
    "thumbnail": null,
    "board": {"pieces": [], "markings": [], "playerCount": 7}
  }
}
```

## 事务与未知结果

新增 `tactic_create_receipts` 表，以队伍、管理员账户、请求编号唯一，保存规范化内容SHA-256、战术编号和创建时刻，不保存凭据。战术、初始版本和回执在同一 SQLite `BEGIN IMMEDIATE` 事务中落库，任一步失败全部回滚。

相同请求编号与内容的重放返回既有战术，不新增版本；对象键顺序不同仍视为同一内容。同编号不同内容返回409。不同管理员的编号独立，不得互相读取收据。有编号的新建不借用 `presetName/presetEdition` 的旧预设早退分支，保证每个成功新建都对应自己的收据。

已有战术后来删除时回执保留，查询返回 `available:false`；旧POST重放返回410，不复活删除对象。查询仅表示历史新建结果，不承诺该对象仍未被后续编辑。重启服务后可核对已提交结果。

客户端必须在发出POST前保留非秘密请求编号及账号/服务作用域。超时、断网、离开页面后的未知结果先GET核对，不自动换编号重建；在原请求仍进行时，404不能证明它稍后不会提交。用户明确开启另一次新建时应使用新编号，不能把修改过的表单沿旧编号提交。

## 自动化与待验边界

`node --test server/tactic-create.test.mjs` 使用隔离匿名库，覆盖目录、旧网页兼容、同内容重放、内容冲突、账号/角色/球队隔离、版本/回执故障回滚、删除防复活及重启恢复。测试使用原生HTTP请求头，不放宽浏览器Origin或原生鉴权保护。

本批未更改既有战术历史快照语义；新建页面的实际操作、系统文件选择、画布显示仍需独立界面验收。收据为同机SQLite持久记录，不是多设备客户端写入排序或分布式限流承诺。
