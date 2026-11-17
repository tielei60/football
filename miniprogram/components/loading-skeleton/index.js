Component({
 options:{styleIsolation:'isolated'},
 properties:{
  type:{type:String,value:'list',observer:'rebuild'},
  rows:{type:Number,value:3,observer:'rebuild'},
  label:{type:String,value:'正在加载，请稍候'},
  animated:{type:Boolean,value:false}
 },
 data:{items:[0,1,2],variant:'list'},
 lifetimes:{attached(){this.rebuild();}},
 methods:{rebuild(){
  const count=Math.max(1,Math.min(8,Math.floor(Number(this.data.rows)||3)));
  const variant=['list','form','detail','cards','home'].includes(this.data.type)?this.data.type:'list';
  this.setData({items:Array.from({length:count},(_,i)=>i),variant});
 }}
});
