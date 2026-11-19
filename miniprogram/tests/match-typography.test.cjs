// 静态约束不代表真实设备字号、输入光标、触控或视觉验收。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const baseline=require('./match-typography-baseline.json');
const root=path.join(__dirname,'../pages');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const read=(p,e)=>fs.readFileSync(path.join(root,p,'index.'+e),'utf8');
for(const [page,b] of Object.entries(baseline)) {
if(page==='match-detail'||page==='match-roster'||page==='match-edit'||page==='match-media')continue; // match-media 的完整原模板/JS与非文字几何现由 ui-depth 精确保护。 // 已重新设计的页面使用当前结构约束。
test(`match typography ${page}: structure, existing geometry and scope unchanged`,()=>{
 const markup=read(page,'wxml').replace('<view wx:if="{{admin}}" class="photo-order-actions"><button size="mini" class="ui-button" data-id="{{item.id}}" data-delta="-1" bindtap="move" disabled="{{loading||busy||conflict||uncertain||index===0}}">上移</button><button size="mini" class="ui-button" data-id="{{item.id}}" data-delta="1" bindtap="move" disabled="{{loading||busy||conflict||uncertain||index===photos.length-1}}">下移</button></view>','').replace('<button wx:if="{{savedId}}" disabled="{{loading||busy}}" class="primary ui-button ui-block" size="mini" bindtap="openSaved">进入已保存比赛</button>','').replace('busy || conflict || uncertain || savedId','busy || conflict || uncertain').replace(/\sclass="[^"]*"/g,'');assert.equal(hash(markup),b.markupSha256);
 const css=read(page,'wxss').replace('\n/* 相册排序独立双列，避免与封面、移除操作挤在同一行。 */\n.photo-order-actions{display:flex;gap:12rpx;margin-top:12rpx;min-width:0}\n.photo-order-actions button.ui-button[size="mini"]{flex:1 1 0;width:0;min-width:0;min-height:44px;margin:0;box-sizing:border-box;padding:16rpx 12rpx;line-height:1.5;white-space:nowrap}\n',''),start=css.indexOf('\n/* 比赛文字层级：');assert.ok(start>=0);
 assert.equal(hash(css.slice(0,start)),b.cssPrefixSha256);
 const extra=css.slice(start).replace(/\/\*[\s\S]*?\*\//g,'');
 assert.doesNotMatch(extra,/\b(?:input|textarea|button|picker|canvas|map)\b|\.notice\b|\.actions\b/);
 for(const [,body] of extra.matchAll(/\{([^{}]*)\}/g))for(const [,prop] of body.matchAll(/([\w-]+)\s*:/g))assert.ok(['font-size','font-weight','line-height','color'].includes(prop),prop);
 assert.doesNotMatch(extra,/max\(/);
 assert.match(extra,/\.error\{font-size:26rpx;font-weight:500\}/);
});}
test('match typography preserves role branches, unknown semantics and narrower content targeting',()=>{
 const detail=read('match-detail','wxml'),media=read('match-media','wxml');
 assert.match(detail,/class="match-sheet"/);assert.match(detail,/class="match-facts"/);assert.doesNotMatch(detail,/<map\b/);
 assert.doesNotMatch(media,/match-notice|saveNotice|data-field="notice"/);
 const edit=read('match-edit','wxml');assert.match(edit,/<label[^>]*for="match-notice">本场须知（选填）<\/label>/);
 const notice=edit.match(/<textarea\b[^>]*id="match-notice"[^>]*>/)?.[0];assert.ok(notice,'比赛表单拥有唯一须知编辑框');
 for(const attr of ['value="{{form.notice}}"','data-field="notice"','bindinput="input"','maxlength="10000"','disabled="{{busy}}"'])assert.ok(notice.includes(attr),attr);
 assert.match(media,/class="photo-caption"/);
 assert.match(media,/class="hint upload-uncertain"/);
 assert.match(read('match-roster','wxml'),/保存后将替换本场完整名单/);
 assert.match(read('match-detail','js'),/unknown:\s*"未确定"/);
 assert.match(read('match-roster','js'),/label: '未确定', value: 'unknown'/);
});

test('match detail prioritizes match facts and groups roster and replies without individual cards',()=>{
 const detail=read('match-detail','wxml'),css=read('match-detail','wxss');
 assert.ok(detail.indexOf('class="match-sheet"')<detail.indexOf('class="content-section attendance-section"'));
 assert.match(detail,/class="attendance-summary"/);assert.match(detail,/class="roster-row"/);
 assert.doesNotMatch(detail,/wx:for="{{roster}}"[^>]*class="card"/);
 assert.match(detail,/wx:if="{{canReply}}" class="fixed-actions"/);
 assert.match(css,/\.reply-grid\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
});
