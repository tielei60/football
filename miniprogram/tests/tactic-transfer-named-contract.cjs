// 17O 具名导入是已审业务增量；每段必须精确且唯一，其余代码仍由原 SHA 冻结。
const assert=require('node:assert/strict');
const pairs=require('./tactic-transfer-named-contract.json');
function restore(source,kind){for(const [current,original]of pairs[kind]){assert.equal(source.split(current).length-1,1,'17O 精确唯一 '+kind+' 增量');source=source.replace(current,original);}return source;}
exports.restoreJS=source=>restore(source,'js');exports.restoreMarkup=source=>restore(source,'wxml');
