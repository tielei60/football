# 足球俱乐部 · 微信原生小程序

原生 JavaScript + WXML + WXSS，复用仓库 Node/SQLite 服务。完整范围、配置和验收见 [项目说明](../docs/wechat-miniprogram.md)。

本地开发者工具导入本目录，填写 `config.js` 的服务根地址；生产只用 HTTPS。账号沿用俱乐部管理员创建的账号，并非微信一键登录。

```sh
npm ci
npm run check
```

未配置真实 AppID、合法域名或部署，不等于已经发布微信小程序。完整战术编辑和名单管理仍在网页端。
