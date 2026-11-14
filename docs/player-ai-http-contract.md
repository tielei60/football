# 私有照片生成 HTTP 接线契约（后端已接线，未上线）

本批实现完整的受控流程，但不配置真实供应商、密钥或收费。未配置可信服务端适配器及授权/预算策略时，能力关闭，服务器拒绝接收原图和生成请求。不能通过环境变量、客户端请求或公开演练口令切换供应商。测试使用隔离数据库和合成几何图片。

## 权限及模式

所有下述路径位于 `/api/players/:playerId/ai`，必须有效会话、同队管理员、在队目标球员。来源、任务与候选同时限定原上传者；其他管理员不能自动读取。作用域、身份、价格、供应商和授权版本均由服务器派生，不接受请求中的角色或 openid。响应禁止缓存，不提供公开图片 URL。

`GET /capabilities` 返回 `{enabled,mode,uploadMode,player,albumRevision,styles,purposes,samples,currency,maxAmountMinor,policyVersion}`。`player` 最少为 `{id,name,revision}`；用途为 avatar/portrait。mode 为 disabled/local-simulation/configured-provider（最后一项只能由可信服务端装配，仓库不提供真实供应商适配器），uploadMode 为 disabled/sample/file。

- disabled：不选图、不上传、不生成。
- local-simulation/sample：仅选择服务器固定合成样本；不能用任意 dataUrl 伪装模拟图片。结果始终显示“本地模拟图，非真实 AI 生成”。
- file：前端系统选图代码与上传 API 保留，但只有未来可信服务端完整策略允许才可用；本轮只用合成文件自动测试，不代表真实照片、系统选图或供应商已验收。

公开 `/api/auth/capabilities` 仅增加 `aiPhotos` 布尔，不暴露策略或身份。详细能力仍须管理员鉴权。

## 同意、来源与恢复

同意记录是本系统流程确认，不伪称已核实球员法律授权或第三方处理授权。configured-provider模式必须有可信服务端逐球员授权回调及目的地、条款、保留、训练用途、取消费用披露和预算策略；界面勾选不能替代这些要求。

- `POST /consents`：`{requestId,purpose,styleId,policyVersion,maxAmountMinor,confirmed:true,sourceId?,sourceRevision?}`。purpose为private-ai-source/avatar/portrait；生成同意须绑定已授权的sourceId/revision。返回同意收据id与必要状态，不返回身份凭据。
- `GET /consents?requestId=...`：仅本人同目标的请求核对。
- `POST /consents/:id/revoke`：`{revision}`，撤回某次处理同意，不复活已取消或迟到任务。
- `POST /sources`：sample模式`{requestId,consentId,sampleId}`；file模式`{requestId,consentId,dataUrl}`。两者互斥，不能由客户端改模式。保留期由服务器决定。返回`{id,revision,status}`。
- `GET /sources?requestId=...`：仅本人核对未知上传结果；不自动重试不确定的写入。
- `DELETE /sources/:id`：`{revision}`。撤回原来源使未采用候选不可读取或采用，迟到完成不得复活。

客户端可以保存非秘密收据ID用于恢复，不能保存原图、邀请码或会话以外的额外秘密。图片临时缓存独立且退出时清理。

## 任务与候选

- `POST /jobs`：`{requestId,consentId,sourceId,sourceRevision,purpose,styleId}`，返回已持久任务元数据。用途与风格必须匹配同意；价格由服务器固定策略确定。后台执行有界，查询不重新提交供应商。
- `GET /jobs?requestId=...`：本人请求恢复。
- `GET /jobs/:id`：任务状态、revision、允许公开给本人的候选元数据；不返回供应商内部凭据。
- `POST /jobs/:id/cancel`：`{revision}`。取消不会被迟到结果覆盖；未知提交结果不可盲重试。
- `GET /candidates/:id`：仅本人、有效授权、任务和来源版本均有效时返回`{dataUrl,originKind,generated:true,aiGenerated,simulation,...}`，模拟图originKind为local-simulation、aiGenerated为false、simulation为true；真实生成才为ai-generated及aiGenerated=true。
- `DELETE /candidates/:id`：`{revision}`。删除私有候选不自动改已明确采用的公开资料。

不提供 transition、settle、供应商回调模拟或任意URL代理接口。

## 明确采用

`POST /adoptions`：`{requestId,candidateId,candidateRevision,target,targetRevision,confirmed:true}`。

`GET /adoptions?requestId=...` 仅向有当前会话和目标权限的原操作者返回无图片历史收据，候选删除/过期后仍可核对，但不重新采用。

用途严格对应：avatar同意只可采用avatar，portrait同意只可采用cover。仅两个target：

- avatar：替换球员头像，targetRevision为球员revision；同步旧战术桌球员投影，保留比赛历史。
- cover：新增一张球员照片并明确设为出场封面，targetRevision为相册revision；保留旧照片，不修改头像；上限9张仍适用。

同事务核验当前会话、原上传者、同意/来源/任务/候选版本、容量与目标CAS，然后写采用收据与资料。重放同requestId只返回原收据，不重复新增。来源标记由服务器持久写入，客户端不能伪造；普通手动更换头像须清除旧AI标记。仅加入相册但不设封面是未来独立意图，不能借旧上传的首张自动封面行为偷偷采用。

## 本文状态

后端已实现本契约并完成隔离 HTTP 与权限回归，详见[服务检查记录](player-ai-service-review.md)。前端与实际 UI 验收仍单独记录；本契约不等于全流程已验收。生产能力默认关闭，未调用真实微信或AI服务，没有费用或真实照片外发。
