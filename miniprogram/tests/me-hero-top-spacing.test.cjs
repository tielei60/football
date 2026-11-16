const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('我的全幅身份区顶部与页边距精确相抵，不用偏移遮盖导航白缝',()=>{
 const global=read('app.wxss'),local=read('pages/me/index.wxss');
 const base=global.match(/\.page\s*\{([^}]+)}/)[1];assert.match(base,/padding:\s*32rpx 28rpx/);
 const pageRules=[...local.matchAll(/(?:^|})\s*(?:\/\*[\s\S]*?\*\/\s*)?\.page\s*\{([^}]+)}/g)];
 const padding=pageRules.map(m=>m[1].match(/padding-top:\s*([\d.]+)rpx/)).filter(Boolean).at(-1);
 assert.ok(padding,'必须有独立的全幅页顶部间距');
 const hero=local.match(/\.membership-hero\.card\s*\{[^}]*margin:\s*(-?[\d.]+)rpx -28rpx 0/);assert.ok(hero);
 for(const width of [320,375,430])assert.equal((Number(padding[1])+Number(hero[1]))*width/750,0,'顶部露底 '+width);
 for(const rule of local.matchAll(/\.membership-hero\.card\s*\{([^}]+)}/g))assert.doesNotMatch(rule[1],/(?:^|;)\s*(?:top|transform)\s*:/);
 const host=read('components/page-state/index.wxss').match(/:host\s*\{([^}]+)}/)[1];
 assert.match(host,/display:block/);assert.doesNotMatch(host,/(?:padding|margin|height)\s*:/,'空状态host不能额外占顶部间距');
});
