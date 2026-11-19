const assert = require('node:assert/strict');
const contract = require('./guest-player-ui-projection.json');
function normalize(file, source) {
  for (const {before, after} of contract.changes[file] || []) {
    assert.equal(source.split(after).length, 2, '临时球员获准片段必须完整且唯一: ' + file);
    source = source.replace(after, before);
  }
  return source;
}
module.exports = {normalize};
