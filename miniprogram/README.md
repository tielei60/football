# 足球俱乐部 · 微信原生小程序

原生 JavaScript + WXML + WXSS，复用仓库 Node/SQLite 服务。完整范围、配置和验收见 [项目说明](../docs/wechat-miniprogram.md)。

先执行 `npm run setup`，再由开发者工具导入本目录，填写生成的 `config.js` 服务根地址；生产只用 HTTPS。账号沿用俱乐部管理员创建的账号，并非微信一键登录。

```sh
npm ci
npm run setup
npm run check
```

未配置真实 AppID、合法域名或部署，不等于已经发布微信小程序。完整战术编辑和名单管理仍在网页端。

## 本机配置与提交边界

`config.example.js` 和 `project.config.example.json` 是可提交的安全模板，默认 HTTPS、开启合法域名校验，并使用游客 AppID。`npm run setup` 只创建缺失文件，绝不覆盖已有配置；`npm test` 也会先执行此初始化。

实际 `config.js`、`project.config.json` 和开发者工具生成的 `project.private.config.json` 均被 Git 忽略。真实 AppID、本机地址及临时调试设置只保留在本机，不提交 GitHub。请在本机填写自己的 AppID 和服务地址；模板不代表已经配置合法域名或发布。CI 显式初始化后执行检查。
