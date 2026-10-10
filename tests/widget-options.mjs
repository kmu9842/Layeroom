import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {options,configure,bounds}=createRequire(import.meta.url)('../widget/options.cjs');
test('only the three widget options are mutable',()=>{
 const original=options({}, {autoRotate:true,followMouse:false});assert.deepEqual(original,{autoRotate:true,followMouse:false,size:'medium'});
 assert.deepEqual(configure(original,{followMouse:true,size:'large'}),{autoRotate:true,followMouse:true,size:'large'});
 for(const value of [{layer_order:[1,2]},{frame:'carbon'},{size:'enormous'},{autoRotate:'yes'},null])assert.throws(()=>configure(original,value));
 assert.equal(options({size:'toString'}).size,'medium');assert.equal(original.size,'medium');
});
test('default position is in a display corner and resizing preserves bottom/right',()=>{
 const work={x:1920,y:0,width:1920,height:1040},start=bounds('medium',work);assert.equal(start.x+start.width,3822);assert.equal(start.y+start.height,1022);
 const larger=bounds('large',work,start);assert.equal(larger.x+larger.width,start.x+start.width);assert.equal(larger.y+larger.height,start.y+start.height);
});
test('offscreen preferences are clamped on monitor removal, negative coordinates and small displays',()=>{
 for(const work of [{x:0,y:0,width:1366,height:728},{x:-1920,y:-200,width:1920,height:1040},{x:0,y:0,width:400,height:300}]){
  const result=bounds('large',work,{x:9000,y:4000,width:320,height:420});assert.ok(result.x>=work.x&&result.y>=work.y);assert.ok(result.x+result.width<=work.x+work.width&&result.y+result.height<=work.y+work.height);
 }
});
