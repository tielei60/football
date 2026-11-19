const assert=require('node:assert/strict');
const changes=require('./match-guest-share-projection.json');
function normalize(file,source){for(const block of changes[file]||[]){assert.equal(source.split(block.after).length,2,'访客分享获准片段必须完整且唯一: '+file);source=source.replace(block.after,block.before);}return source;}
module.exports={normalize,changes};
