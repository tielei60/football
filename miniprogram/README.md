# 足球俱乐部 · 微信原生小程序

原生 JavaScript + WXML + WXSS，复用仓库 Node/SQLite 服务。完整范围、配置和验收见 [项目说明](../docs/wechat-miniprogram.md)。

先执行 `npm run setup`，再由开发者工具导入本目录，填写生成的 `config.js` 服务根地址；生产只用 HTTPS。默认使用俱乐部管理员创建的账号登录。微信登录与邀请认领需服务端显式启用并完成真实微信配置，本地模拟验收不代表真实微信链路已验证。

```sh
npm ci
npm run setup
npm run check
```

未配置真实 AppID、合法域名或部署，不等于已经发布微信小程序。小程序已提供比赛与赛季名单管理，以及战术新建、阵型设置、竖屏画布编辑、动画编排和导入导出入口。各功能的支持范围、实际验收结果和已知限制见项目说明与对应验收文档；功能入口存在不等于所有设备、系统文件选择或全部业务分支已完成验证。

## 本机配置与提交边界

`config.example.js` 和 `project.config.example.json` 是可提交的安全模板，默认 HTTPS、开启合法域名校验，并使用游客 AppID。`npm run setup` 只创建缺失文件，绝不覆盖已有配置；`npm test` 也会先执行此初始化。

实际 `config.js`、`project.config.json` 和开发者工具生成的 `project.private.config.json` 均被 Git 忽略。真实 AppID、本机地址及临时调试设置只保留在本机，不提交 GitHub。请在本机填写自己的 AppID 和服务地址；模板不代表已经配置合法域名或发布。CI 显式初始化后执行检查。
