const assert = require('node:assert/strict');
const reviewed = require('./signup-self-binding-projection.json');
// 仅逆投影本轮本人绑定、报名分享和对手队徽的明确变更，旧权限基线不变。
function normalize(file, source) {
  for (const {before, after} of reviewed[file]?.changes || []) {
    assert.equal(source.split(after).length, 2, file + ': self-binding/signup change must be complete and unique');
    source = source.replace(after, before);
  }
  return source;
}
module.exports = {normalize, reviewed};
