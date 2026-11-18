import assert from 'node:assert/strict';
import test from 'node:test';
import {createApp,ref,nextTick} from 'vue';
import {createPinia,defineStore} from 'pinia';
import plugin from 'pinia-plugin-persistedstate';
test('持久化依赖兼容旧JSON、字段筛选、水合回调与自定义迁移', async()=>{
const cache=new Map(),storage={getItem:k=>cache.get(k)??null,setItem:(k,v)=>cache.set(k,v)};
let hydrated=0;
const old={currentAnimation:{name:'已保存战术',frames:[{players:[{id:7,x:123,y:456}]}]},frameTime:6,loop:true,showTrails:false};
cache.set('animation',JSON.stringify(old));
const pinia=createPinia();pinia.use(plugin);createApp({}).use(pinia);
const use=defineStore('animation',()=>({currentAnimation:ref(null),frameTime:ref(3),loop:ref(false),showTrails:ref(true),temporarySelection:ref('do-not-store')}),{persist:{storage,pick:['currentAnimation','frameTime','loop','showTrails'],serializer:{serialize:JSON.stringify,deserialize:v=>{let x=JSON.parse(v);return {...x,currentAnimation:x.currentAnimation??x.animations?.at(-1)}}},afterHydrate:()=>{hydrated++}}});
const store=use(pinia);assert.equal(hydrated,1);for(let [k,v]of Object.entries(old))assert.deepEqual(JSON.parse(JSON.stringify(store[k])),v);
store.frameTime=1.5;await nextTick();assert.deepEqual(JSON.parse(cache.get('animation')),{...old,frameTime:1.5});assert.ok(!cache.get('animation').includes('temporarySelection'));
cache.set('animation',JSON.stringify({animations:[old.currentAnimation],frameTime:3,loop:false,showTrails:true}));store.$hydrate();assert.equal(hydrated,2);assert.deepEqual(JSON.parse(JSON.stringify(store.currentAnimation)),old.currentAnimation);
});
