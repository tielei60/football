// Official wcc/wcsc compiler smoke validation, not device interaction/visual certification.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {wxmlToJs,wxssToJs}=require('miniprogram-compiler');
const root=path.resolve(__dirname,'..');
const config=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'));
const gwx=new Function('window',wxmlToJs(root))({});
assert.ok(wxssToJs(root).length);
const clone=value=>JSON.parse(JSON.stringify(value));
let renders=0;
function render(file,data,label){assert.ok(gwx(file+'.wxml')(clone(data)),file+' renders '+label);renders++;}
function handlers(file,definition){const source=fs.readFileSync(path.join(root,file+'.wxml'),'utf8');for(const tag of source.matchAll(/<[a-z][^>]*>/g))assert.ok((tag[0].match(/\sid=/g)||[]).length<=1,file+' has no repeated id attribute on one element');for(const match of source.matchAll(/\b(?:bind|catch)(?::)?[a-z]+="([a-zA-Z]\w*)"/g))assert.equal(typeof definition[match[1]],'function',file+' handler '+match[1]);}
for(const page of config.pages){
 let definition;global.Page=value=>{definition=value;};require(path.join(root,page+'.js'));
 assert.ok(definition,page+' registers Page');
 JSON.parse(fs.readFileSync(path.join(root,page+'.json'),'utf8'));
 const initial=definition.data||{};
 render(page,initial,'initial');
 render(page,{...initial,loading:true,error:'',empty:false},'loading');
 render(page,{...initial,loading:false,error:'模拟加载失败，请重试',empty:false},'error');
 const empty={...initial,loading:false,error:'',empty:true};
 // Only clear existing top-level collection fields; do not invent loaded records.
 for(const [key,value]of Object.entries(initial))if(Array.isArray(value)&&!['tabs','tools','colors','widths','durations','positions','counts','teams','statuses','formats','feet','sides','selections','appearances'].includes(key))empty[key]=[];
 render(page,empty,'empty collections');
 handlers(page,definition);
}
let components=0;
for(const dir of fs.readdirSync(path.join(root,'components'))){
 const file='components/'+dir+'/index',filename=path.join(root,file+'.js');if(!fs.existsSync(filename))continue;
 let definition;global.Component=value=>{definition=value;};require(filename);assert.ok(definition,file+' registers Component');
 const props={};for(const [key,property]of Object.entries(definition.properties||{})){
  const spec=typeof property==='function'?{type:property}:property;
  if(spec?.value!==undefined)props[key]=spec.value;else if(spec?.type===Boolean)props[key]=false;else if(spec?.type===Number)props[key]=0;else if(spec?.type===String)props[key]='';else if(spec?.type===Array)props[key]=[];else props[key]=null;
 }
 const initial={...props,...definition.data};render(file,initial,'default props');handlers(file,definition.methods||{});components++;
 if(dir==='page-state'){
  render(file,{...initial,loading:true,error:'',empty:false},'loading props');
  render(file,{...initial,loading:false,error:'模拟错误',empty:false},'error props');
  render(file,{...initial,loading:false,error:'',empty:true},'empty props');
 }
 if(dir==='loading-skeleton')for(const variant of ['list','detail','form','cards'])render(file,{...initial,variant,type:variant,rows:3},variant+' skeleton props');
}
for(const entry of config.tabBar.list){assert.ok(config.pages.includes(entry.pagePath));for(const key of ['iconPath','selectedIconPath'])assert.ok(fs.existsSync(path.join(root,entry[key])));}
console.log(`Official WXML/WXSS virtual rendering: ${config.pages.length} pages × initial/loading/error/empty, ${components} components, ${renders} renders; routes, handlers, tab icons verified. Not device interaction or visual acceptance.`);
