const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {normalize,reviewed}=require('./match-media-album-only-projection.cjs');
for(const [file,contract] of Object.entries(reviewed))test(file+': album-only projection preserves the archived baseline and rejects changed or duplicate fragments',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 assert.equal(crypto.createHash('sha256').update(normalize(file,source)).digest('hex'),contract.sha256);
 for(const {after} of contract.changes){
  assert.throws(()=>normalize(file,source.replace(after,after+after)));
  assert.throws(()=>normalize(file,source.replace(after,after.replace(/\S/,'!'))));
 }
 const extra='\n// unreviewed source remains covered by the original hash\n';
 assert.equal(normalize(file,source+extra),normalize(file,source)+extra);
});
