// 静态约束不代表真实设备字号、输入光标、触控或视觉验收。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const baseline=require('./match-typography-baseline.json');
const root=path.join(__dirname,'../pages');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const read=(p,e)=>fs.readFileSync(path.join(root,p,'index.'+e),'utf8');
for(const [page,b] of Object.entries(baseline))test(`match typography ${page}: structure, existing geometry and scope unchanged`,()=>{
 const markup=read(page,'wxml').replace('<button wx:if="{{savedId}}" disabled="{{loading||busy}}" class="primary ui-button ui-block" size="mini" bindtap="openSaved">进入已保存比赛</button>','').replace('busy || conflict || uncertain || savedId','busy || conflict || uncertain').replace(/\sclass="[^"]*"/g,'');assert.equal(hash(markup),b.markupSha256);
 const css=read(page,'wxss'),start=css.indexOf('\n/* 比赛文字层级：');assert.ok(start>=0);
 assert.equal(hash(css.slice(0,start)),b.cssPrefixSha256);
 const extra=css.slice(start).replace(/\/\*[\s\S]*?\*\//g,'');
 assert.doesNotMatch(extra,/\b(?:input|textarea|button|picker|canvas|map)\b|\.notice\b|\.actions\b/);
 for(const [,body] of extra.matchAll(/\{([^{}]*)\}/g))for(const [,prop] of body.matchAll(/([\w-]+)\s*:/g))assert.ok(['font-size','font-weight','line-height','color'].includes(prop),prop);
 assert.doesNotMatch(extra,/max\(/);
 assert.match(extra,/\.error\{font-size:26rpx;font-weight:500\}/);
});
test('match typography preserves role branches, unknown semantics and narrower content targeting',()=>{
 const detail=read('match-detail','wxml'),media=read('match-media','wxml');
 assert.match(detail,/class="card match-facts"/);assert.match(detail,/hidden="\{\{businessUiBlocking\}\}"/);
 assert.match(media,/<textarea wx:if="\{\{admin\}\}" class="input notice"/);
 assert.match(media,/<text wx:else class="prewrap"/);
 assert.match(media,/class="hint upload-uncertain"/);
 assert.match(read('match-roster','wxml'),/class="hint roster-warning"/);
 assert.match(read('match-detail','js'),/unknown:\s*"未确定"/);
 assert.match(read('match-roster','js'),/label: '未确定', value: 'unknown'/);
});

test('match detail soft-surface metric labels use brand ink rather than muted',()=>{assert.match(read('match-detail','wxss'),/\.metric \.label\{font-size:25rpx;color:var\(--brand-ink\)\}/);});
