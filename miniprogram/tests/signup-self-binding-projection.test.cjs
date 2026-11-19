const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {normalize,reviewed}=require('./signup-self-binding-projection.cjs');
for(const [file,{changes}] of Object.entries(reviewed))test(file+' 本人绑定/报名分享精确投影拒绝篡改重复，不吞其他逻辑',()=>{
 const source=require('./match-guest-share-projection.cjs').normalize(file,fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
 assert.equal(normalize(file,source+'\nextra'),normalize(file,source)+'\nextra');
 for(const {after} of changes){assert.throws(()=>normalize(file,source.replace(after,after+after)));assert.throws(()=>normalize(file,source.replace(after,after.replace(/\S/,'MUTATED'))));}
});
