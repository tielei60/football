Component({
 options:{styleIsolation:'isolated'},
 data:{modal:null,transient:null,inputValue:'',inputFocus:false,pickerYearMode:false,pickerSummary:'',hourAnchor:'',minuteAnchor:'',bodyHeight:160,selectorAnchor:''},
 lifetimes:{detached(){this._detached=true;this._bridge?.detach();this._bridge=null;}},
 methods:{
  connect(bridge){this._bridge=bridge;},
  summary(state){
   if(!state)return '';
   const value=state.draft;
   if(state.mode==='date'&&state.fields==='day'&&/^\d{4}-\d{2}-\d{2}$/.test(value)){
    const [y,m,d]=value.split('-').map(Number);
    return value+' · 周'+'日一二三四五六'[new Date(y,m-1,d).getDay()];
   }
   if(state.mode==='selector')return state.labels?.[value]||'';
   return String(value||'');
  },
  pickerMeta(state){
   return {pickerSummary:this.summary(state),hourAnchor:'picker-hour-'+Math.max(0,(state?.hours||[]).findIndex(x=>x.selected)),minuteAnchor:'picker-minute-'+Math.max(0,(state?.minutes||[]).findIndex(x=>x.selected))};
  },
  bodySize(modal){
   if(modal?.kind==='picker'){
    const state=modal.pickerState;
    if(state?.mode==='time')return 432;
    return state?.mode==='selector'?Math.min(680,Math.max(120,(state.rows?.length||0)*92+8)):680;
   }
   const lines=String(modal?.content||'').split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/17)),0);
   return Math.min(680,Math.max(50,lines*46+(modal?.editable?130:0)));
  },
  present(state){
   if(this._detached)return;
   const changed=state.modal?.id!==this.data.modal?.id;
   const modal=!changed&&state.modal?.kind==='picker'?{...state.modal,pickerState:this.data.modal.pickerState}:state.modal;
   this.setData({...state,modal,...(changed?{inputValue:modal?.value||'',inputFocus:!!modal?.editable,pickerYearMode:false,selectorAnchor:modal?.pickerState?.mode==='selector'?'picker-option-'+modal.pickerState.draft:'',bodyHeight:this.bodySize(modal),...this.pickerMeta(modal?.pickerState)}:{})});
  },
  clearInput(){if(!this._detached)this.setData({inputValue:'',inputFocus:false,pickerYearMode:false,pickerSummary:''});},
  input(e){if(!this.data.modal?.editable)return;this.setData({inputValue:String(e.detail.value).slice(0,this.data.modal.maxlength)});},
  confirm(){
   if(!this.data.modal)return;
   if(this.data.modal.kind==='picker'){
    const model=require('../../utils/picker-model'),state=this.data.modal.pickerState;
    if(!model.valid(state))return;
    this._bridge?.confirm(this.data.modal.id,model.result(state));
   }else this._bridge?.confirm(this.data.modal.id,this.data.inputValue);
  },
  pickerOption(e){
   if(this.data.modal?.kind!=='picker')return;
   const model=require('../../utils/picker-model'),next=model.select(this.data.modal.pickerState,e.currentTarget.dataset.value);
   this.setData({'modal.pickerState':next,...this.pickerMeta(next)});
  },
  pickerNavigate(e){
   if(this.data.modal?.kind!=='picker')return;
   const model=require('../../utils/picker-model');
   this.setData({'modal.pickerState':model.navigate(this.data.modal.pickerState,Number(e.currentTarget.dataset.delta))});
  },
  pickerYears(){if(this.data.modal?.pickerState?.mode==='date')this.setData({pickerYearMode:!this.data.pickerYearMode});},
  pickerYear(e){
   if(this.data.modal?.pickerState?.mode!=='date')return;
   const model=require('../../utils/picker-model');
   this.setData({'modal.pickerState':model.jump(this.data.modal.pickerState,Number(e.currentTarget.dataset.value)),pickerYearMode:false});
  },
  cancel(){if(this.data.modal?.showCancel)this._bridge?.cancel(this.data.modal.id);},
  mask(){if(this.data.modal?.showCancel)this.cancel();},
  swallow(){},
 }
});