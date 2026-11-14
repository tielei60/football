Component({
 properties:{loading:Boolean,error:String,empty:Boolean,skeletonType:{type:String,value:'list'}},
 methods:{retry(){if(!this.data?.loading)this.triggerEvent('retry');}}
});
