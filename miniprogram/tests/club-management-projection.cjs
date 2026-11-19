const assert = require('node:assert/strict');
const reviewed = require('./club-management-projection.json');

// Only the reviewed catalog/template and season-media changes are reversed.
// Existing auth, persistent-receipt and business hashes remain unchanged.
function normalize(file, source) {
  for (const { before, after } of reviewed[file]?.changes || []) {
    assert.equal(source.split(after).length, 2, `${file}: reviewed club change must be complete and unique`);
    source = source.replace(after, before);
  }
  return source;
}

module.exports = { normalize, reviewed };
