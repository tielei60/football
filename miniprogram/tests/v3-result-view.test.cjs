const test=require('node:test'),assert=require('node:assert/strict');
const view=require('../utils/match-result-view');
test('首页胜平负只依据已完赛完整我方/对方比分，客场不颠倒',()=>{
 for(const side of ['home','away','neutral']){
  assert.equal(view({status:'completed',homeScore:2,awayScore:0,side}).resultLabel,'胜');
  assert.equal(view({status:'completed',homeScore:0,awayScore:0,side}).resultLabel,'平');
  assert.equal(view({status:'completed',homeScore:0,awayScore:1,side}).resultLabel,'负');
 }
 for(const homeScore of [null,undefined,NaN,'2'])assert.equal(view({status:'completed',homeScore,awayScore:0}).resultTone,'unknown');
 assert.equal(view({status:'published',homeScore:0,awayScore:0}).resultTone,'unknown');
 assert.equal(view({status:'completed',homeScore:0,awayScore:null}).resultTone,'unknown');
});
