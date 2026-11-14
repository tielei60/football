const test=require('node:test');const assert=require('node:assert/strict');
const config=require('../config');const media=require('../utils/media');
test('large raster sources become tiny private file paths, invalid/cross-origin sources rejected',()=>{
 const files=new Map();global.wx={env:{USER_DATA_PATH:'wxfile://usr'},getFileSystemManager:()=>({mkdirSync(){},writeFileSync(path,data,encoding){assert.equal(encoding,'base64');files.set(path,data);},readdirSync(){return [...files.keys()].map(p=>p.split('/').pop());},unlinkSync(path){files.delete(path);}})};
 media.clearImageCache();const source='data:image/png;base64,'+'A'.repeat(2*1024*1024);const result=media.imageSource(source);
 assert.match(result,/^wxfile:\/\/usr\/football-native-images\/img-/);assert.ok(result.length<150);assert.equal(media.imageSource(source),result);assert.equal(files.size,1);
 assert.equal(media.imageSource('https://external.example/avatar.png'),'');assert.equal(media.imageSource('data:image/svg+xml;base64,AAAA'),'');assert.equal(media.imageSource('/../secrets'),'');
 config.apiBaseUrl='https://club.example';assert.equal(media.imageSource('/avatars/a.png'),'https://club.example/avatars/a.png');
 media.clearImageCache();assert.equal(files.size,0);
});
test('cache failures degrade to initials, never raw base64 or arbitrary deletions',()=>{
 const removed=[];global.wx={env:{USER_DATA_PATH:'wxfile://usr'},getFileSystemManager:()=>({mkdirSync(){},writeFileSync(){throw new Error('quota');},readdirSync(){return ['img-1-2.png','other-personal-file','../secret'];},unlinkSync(p){removed.push(p);}})};
 media.clearImageCache();assert.deepEqual(removed,['wxfile://usr/football-native-images/img-1-2.png']);assert.equal(media.imageSource('data:image/png;base64,AAAA'),'');
});
