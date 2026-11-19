const assert = require('node:assert/strict');
const reviewed = require('./match-media-album-only-projection.json');
// Reverse only the reviewed removal of the duplicate notice editor. Keep the
// existing auth/revision/recovery baseline and all unreviewed source unchanged.
function normalize(file, source) {
  for (const {before, after} of reviewed[file]?.changes || []) {
    assert.equal(source.split(after).length, 2, file + ': album-only change must be complete and unique');
    source = source.replace(after, before);
  }
  return source;
}
module.exports = {normalize, reviewed};
