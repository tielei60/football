// Canonical Web TacticCollection only. Strict unknown-field rejection avoids
// silently losing extensions or carrying account/session data into backups.
const MAX_BYTES=8*1024*1024;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=()=>{throw new Error('战术备份格式不受支持或内容无效，请在网页端检查原文件。');};
const text=(v,n=20000)=>{if(typeof v!=='string'||v.length>n)fail();};
const number=v=>{if(typeof v!=='number'||!Number.isFinite(v))fail();};
const integer=v=>{if(!Number.isSafeInteger(v)||v<0)fail();};
const id=v=>{if(!(typeof v==='string'&&v.length>0&&v.length<=20000||Number.isSafeInteger(v)&&v>=0))fail();};
function keys(v,allowed){if(!object(v)||Object.keys(v).some(k=>!allowed.split(' ').includes(k)))fail();}
function optional(v,strings=[],numbers=[]){for(const k of strings)if(v[k]!==undefined)text(v[k]);for(const k of numbers)if(v[k]!==undefined)number(v[k]);}
function array(v,max){if(!Array.isArray(v)||v.length>max)fail();}
function unique(rows,key){const ids=new Set();for(const r of rows){id(r[key]);if(ids.has(r[key]))fail();ids.add(r[key]);}return ids;}
function piece(p){keys(p,'pieceId kind x y color radius label shirtNumber position team playerId');id(p.pieceId);number(p.x);number(p.y);optional(p,['kind','color','label','position','team'],['radius','shirtNumber']);if(p.playerId!==undefined&&p.playerId!==null)text(p.playerId);}
function board(b){
 keys(b,'playerCount pieces markings formationId awayFormationId formationCustomized trainingPlan demonstration');
 array(b.pieces,5000);array(b.markings,5000);b.pieces.forEach(piece);unique(b.pieces,'pieceId');unique(b.markings,'markingId');
 if(b.playerCount!==undefined&&![5,6,7,8,9,11].includes(b.playerCount))fail();
 for(const k of ['formationId','awayFormationId'])if(b[k]!==undefined&&b[k]!==null)text(b[k],300);
 if(b.formationCustomized!==undefined&&typeof b.formationCustomized!=='boolean')fail();
 for(const m of b.markings){keys(m,'markingId kind x y color startX startY endX endY strokeColor backgroundColor width path dashed label');id(m.markingId);optional(m,['kind','color','strokeColor','backgroundColor','label'],['x','y','startX','startY','endX','endY','width']);if(m.dashed!==undefined&&typeof m.dashed!=='boolean')fail();if(m.path!==undefined){array(m.path,100000);for(const p of m.path){if(!Array.isArray(p)||p.length!==2)fail();p.forEach(number);}}}
 if(b.trainingPlan!=null){keys(b.trainingPlan,'objective instructions durationMinutes');optional(b.trainingPlan,['objective','instructions'],['durationMinutes']);}
 if(b.demonstration!=null){
 const d=b.demonstration;keys(d,'demonstrationId title participants stages runs');id(d.demonstrationId);text(d.title,300);
 array(d.participants,5000);array(d.stages,120);array(d.runs,100000);d.participants.forEach(piece);const ids=unique(d.participants,'pieceId');
 for(const stage of d.stages){keys(stage,'stageNumber title note durationSeconds positions');integer(stage.stageNumber);optional(stage,['title','note'],['durationSeconds']);if(stage.durationSeconds<0)fail();array(stage.positions,5000);unique(stage.positions,'pieceId');for(const p of stage.positions){keys(p,'pieceId x y');if(!ids.has(p.pieceId))fail();number(p.x);number(p.y);}}
 // 服务端旧备份可能保留末阶段曲线：无下一帧时不播放，但备份必须保留。
 for(const r of d.runs){keys(r,'pieceId fromStage bend');if(!ids.has(r.pieceId))fail();integer(r.fromStage);if(r.fromStage>=d.stages.length)fail();keys(r.bend,'x y');number(r.bend.x);number(r.bend.y);}
 }
}
function tactic(t){
 keys(t,'tacticId title tags favorite formationName match board thumbnail createdAt savedAt presetName presetEdition');text(t.title,300);if(!t.title.trim())fail();
 array(t.tags,100);t.tags.forEach(x=>text(x,100));if(typeof t.favorite!=='boolean')fail();if(t.formationName!==null)text(t.formationName);
 if(t.thumbnail!==null)text(t.thumbnail,MAX_BYTES);
 if(t.match!==undefined){keys(t.match,'opponent date score');optional(t.match,['opponent','date','score']);}
 for(const k of ['tacticId','createdAt','savedAt','presetEdition'])if(t[k]!==undefined)integer(t[k]);
 if(t.presetName!==undefined)text(t.presetName,300);board(t.board);
}
function bytes(text){return encodeURIComponent(text).replace(/%[A-F\d]{2}/gi,'_').length;}
function validate(value){
 keys(value,'tactics versions exportedAt collectionName');array(value.tactics,200);array(value.versions,5000);value.tactics.forEach(tactic);
 for(const v of value.versions){keys(v,'tacticNumber note board createdAt');integer(v.tacticNumber);if(v.tacticNumber>=value.tactics.length)fail();if(v.note!==undefined)text(v.note);if(v.createdAt!==undefined)integer(v.createdAt);board(v.board);}
 if(value.exportedAt!==undefined)integer(value.exportedAt);if(value.collectionName!==undefined)text(value.collectionName,300);
 return value;
}
// 导入会触发服务端每套50个历史版本的保留策略；本地先拒绝，避免静默丢历史。
function checkImportVersions(value){const counts=new Map();for(const v of value.versions){const count=(counts.get(v.tacticNumber)||0)+1;counts.set(v.tacticNumber,count);if(count>50)throw new Error('单套战术超过 50 个历史版本，为避免版本丢失，本次未导入。请先保留原备份并拆分整理。');}}
function parse(content){if(typeof content!=='string'||content.length>MAX_BYTES||bytes(content)>MAX_BYTES)throw new Error('备份超过 8 MiB，请使用网页端处理。');let value;try{value=JSON.parse(content.replace(/^\uFEFF/,''));}catch(_){throw new Error('请选择有效的 JSON 战术备份文件。');}validate(value);checkImportVersions(value);return value;}
function serialize(value){validate(value);const result=JSON.stringify({tactics:value.tactics,versions:value.versions,exportedAt:value.exportedAt??Date.now()});if(bytes(result)>MAX_BYTES)throw new Error('备份超过 8 MiB，请使用网页端导出。');return result;}
module.exports={MAX_BYTES,bytes,validate,parse,serialize};
