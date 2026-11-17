const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'../pages');
const titles={"schedule": "比赛", "statistics": "数据", "login": "欢迎归队", "player-detail": "球员档案", "match-edit": "安排比赛", "manage-player": "编辑球员", "manage-season": "编辑赛季", "match-roster": "比赛名单", "match-media": "须知与相册", "tactic-compose": "动画与球员", "tactic-transfer": "战术导入导出", "tactic-setup": "阵型与资料", "tactic-export": "导出战术图片", "player-photos": "出场照片", "wechat-invites": "微信邀请管理", "player-ai": "头像与出场照生成", "force-password": "首次修改密码"};
test('17个原生导航标题按V3设计显示，不改首页导航实现',()=>{
 for(const [page,title] of Object.entries(titles))assert.equal(JSON.parse(fs.readFileSync(path.join(root,page,'index.json'))).navigationBarTitleText,title,page);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'home/index.json'))).navigationBarTitleText,'俱乐部');
});
for(const [page,subject] of [['manage-player','球员'],['manage-season','赛季']])test(`${page} 新增编辑标题仅依赖原id且保留refresh`,()=>{
 for(const id of [undefined,'fixture-id'])for(const available of [true,false]){
  let controller;const seen=[],wx=available?{setNavigationBarTitle:arg=>seen.push(arg.title)}:{};
  vm.runInNewContext(fs.readFileSync(path.join(root,page,'index.js'),'utf8'),{Page:p=>controller=p,require:()=>({}),wx});
  let refreshed=0;controller.refresh=()=>{refreshed++;return 'refresh-result';};
  const result=controller.onLoad({id});assert.equal(controller.id,id);assert.equal(refreshed,1);
  assert.deepEqual(seen,available?[id?'编辑'+subject:'新增'+subject]:[]);
  if(page==='manage-player')assert.equal(result,'refresh-result');else assert.equal(result,undefined);
 }
});
