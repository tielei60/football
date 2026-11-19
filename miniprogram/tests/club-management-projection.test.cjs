const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalize, reviewed } = require('./club-management-projection.cjs');

for (const [file, contract] of Object.entries(reviewed)) {
  test(`${file}: reviewed changes preserve archived baseline and reject tampering or duplication`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.equal(crypto.createHash('sha256').update(normalize(file, source)).digest('hex'), contract.sha256);
    for (const { after } of contract.changes) {
      assert.throws(() => normalize(file, source.replace(after, after + after)));
      assert.throws(() => normalize(file, source.replace(after, after.replace(/\S/, '!'))));
    }
    const extra = '\n// unreviewed additions remain part of the archived hash\n';
    assert.equal(normalize(file, source + extra), normalize(file, source) + extra);
  });
}
