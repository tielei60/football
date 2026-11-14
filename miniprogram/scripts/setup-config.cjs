const fs = require('node:fs');
const path = require('node:path');
function setup(root = path.resolve(__dirname, '..')) {
  const created = [];
  for (const [source, target] of [['config.example.js', 'config.js'], ['project.config.example.json', 'project.config.json']]) {
    try {
      // 独占创建：即使并发执行，也不会覆盖已有 AppID 或本机服务地址。
      fs.copyFileSync(path.join(root, source), path.join(root, target), fs.constants.COPYFILE_EXCL);
      created.push(target);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  return created;
}
if (require.main === module) {
  const created = setup();
  console.log(created.length ? '已创建本机配置：' + created.join('、') : '本机配置已存在，未覆盖。');
}
module.exports = { setup };
