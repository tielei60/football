// Official wcc/wcsc compiler smoke validation, not a device/runtime certification.
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {wxmlToJs,wxssToJs}=require('miniprogram-compiler');
const root=path.resolve(__dirname,'..');
const config=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'));
const gwx=new Function('window',wxmlToJs(root))({});
assert.ok(wxssToJs(root).length);
for(const page of config.pages){
 let definition;global.Page=value=>{definition=value;};require(path.join(root,page+'.js'));
 assert.ok(definition,page+' registers Page');
 JSON.parse(fs.readFileSync(path.join(root,page+'.json'),'utf8'));
 assert.ok(gwx(page+'.wxml')(definition.data),page+' compiles and renders initial state');
 const source=fs.readFileSync(path.join(root,page+'.wxml'),'utf8');
 for(const match of source.matchAll(/\b(?:bind|catch)(?::)?[a-z]+="([a-zA-Z]\w*)"/g))assert.equal(typeof definition[match[1]],'function',page+' handler '+match[1]);
}
for(const entry of config.tabBar.list){assert.ok(config.pages.includes(entry.pagePath));for(const key of ['iconPath','selectedIconPath'])assert.ok(fs.existsSync(path.join(root,entry[key])));}
console.log(`Official WXML/WXSS compilation and initial rendering: ${config.pages.length} pages; routes, handlers, tab icons verified.`);
