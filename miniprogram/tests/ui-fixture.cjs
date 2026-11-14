// Adapter for legacy page business tests. Keep each fixture's explicit modal
// result/delay and toast recorder. The actual custom component/service have
// separate tests; this adapter never invents a confirmation or clicks a UI.
const vm=require('node:vm');
function uiBridge(wx){
 return {
  showModal(page,options){if(typeof wx.showModal!=='function')throw Error('Fixture must supply modal behavior');return wx.showModal(options);},
  showToast(page,options){if(typeof wx.showToast==='function')return wx.showToast(options);},
  abort(page){if(typeof wx.onUiAbort==='function')wx.onUiAbort(page);}
 };
}
function runPage(source,context,options){
 const original=context.require,ui=uiBridge(context.wx||{});
 context.require=reference=>reference.endsWith('/utils/ui')||reference==='../../utils/ui'?ui:original(reference);
 return vm.runInNewContext(source,context,options);
}
module.exports={uiBridge,runPage};
