import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PaintEngine} from '../frontend/paintEngine.js';
const fixture=(width=256,height=256)=>new PaintEngine(width,height,new Uint8ClampedArray(width*height*4).fill(220),new Uint8Array(width*height).fill(255),new Uint8Array(width*height).fill(1),[{color:'#ff0000'},{color:'#00ff00'},{color:'#0000ff'}]);
test('categorical paint has continuous segments, no mixed IDs, and exact undo/redo',()=>{
 const engine=fixture(),before=engine.labels.slice();engine.begin();const box=engine.paint({x:40,y:40},{x:110,y:110},{tool:'part',part:3,size:12});engine.commit();
 assert.ok(box.w*box.h<256*256/8);for(let i=40;i<=110;i++)assert.equal(engine.sample(i,i),3);assert.deepEqual([...new Set(engine.labels)].sort(),[1,3]);
 const after=engine.labels.slice();engine.undo();assert.deepEqual(engine.labels,before);engine.redo();assert.deepEqual(engine.labels,after);
});
test('soft alpha never creates unassigned or numeric-blended labels; erase and restore undo exactly',()=>{
 const e=fixture(),originalAlpha=e.alpha.slice(),originalLabels=e.labels.slice();e.paint({x:127,y:127},{x:130,y:130},{tool:'erase',part:3,size:24,hardness:.25});e.commit();
 assert.equal(e.alpha[128*256+128],0);assert.ok(e.alpha.some(a=>a>0&&a<255));const erased=e.alpha.slice();
 e.paint({x:127,y:127},{x:130,y:130},{tool:'restore',part:3,size:24,hardness:.25});e.commit();assert.equal(e.sample(128,128),3);
 for(let p=0;p<e.alpha.length;p++)assert.ok(e.alpha[p]===0?e.labels[p]===0:[1,3].includes(e.labels[p]));
 e.undo();assert.deepEqual(e.alpha,erased);e.undo();assert.deepEqual(e.alpha,originalAlpha);assert.deepEqual(e.labels,originalLabels);
});
test('a small stroke renders only its region and history stores touched tiles',()=>{
 const e=fixture(1200,1400);e.render();const original=e.output.slice();const box=e.paint({x:420,y:530},{x:435,y:538},{tool:'part',part:2,size:20});e.commit();e.render(box,'mask');
 assert.ok(box.w*box.h<2000);assert.ok(e.historyBytes<65536);assert.equal(e.output[4*(530*1200+420)+1],255);assert.deepEqual(e.output.slice(0,1200*4*500),original.slice(0,1200*4*500));
 e.undo();e.paint({x:420,y:530},{x:420,y:530},{tool:'part',part:3,size:4});e.commit();assert.equal(e.redo(),null);
});
test('empty strokes do not create undo entries and out of canvas gestures are safe',()=>{
 const e=fixture();e.paint({x:-400,y:-400},{x:-390,y:-390},{tool:'erase',part:2,size:20});assert.equal(e.commit(),false);assert.equal(e.undo(),null);assert.equal(e.sample(-1,30),0);
});
