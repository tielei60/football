const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {setup}=require('../scripts/setup-config.cjs');
const root=path.resolve(__dirname,'..');
test('配置模板安全且初始化不覆盖已有本机配置',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'football-config-'));
 try {
  for(const file of ['config.example.js','project.config.example.json'])fs.copyFileSync(path.join(root,file),path.join(dir,file));
  assert.equal(setup(dir).length,2);
  const config=require(path.join(dir,'config.js'));
  assert.equal(config.allowLocalHttp,false);assert.match(config.apiBaseUrl,/^https:\/\//);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'project.config.json'))).appid,'touristappid');
  fs.writeFileSync(path.join(dir,'config.js'),'本机配置保留');
  fs.writeFileSync(path.join(dir,'project.config.json'),'本机 AppID 保留');
  assert.deepEqual(setup(dir),[]);
  assert.equal(fs.readFileSync(path.join(dir,'config.js'),'utf8'),'本机配置保留');
  assert.equal(fs.readFileSync(path.join(dir,'project.config.json'),'utf8'),'本机 AppID 保留');
  assert.equal(fs.existsSync(path.join(dir,'project.private.config.json')),false);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('初始化缺少模板时明确失败，不掩盖配置错误',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'football-config-'));
 try {assert.throws(()=>setup(dir),{code:'ENOENT'});}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
