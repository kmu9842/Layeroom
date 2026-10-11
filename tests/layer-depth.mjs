import {test} from 'node:test';
import assert from 'node:assert/strict';
import {layerPositions,depthOrder,changeLayerPosition,reorderedPositions} from '../frontend/layerDepth.js';

test('untouched PSD order and evenly spaced coordinates remain exact',()=>{
 const order=[9,7,5,3];const positions=layerPositions(order);
 assert.deepEqual(order.map(id=>positions[id]),[0,1/3,2/3,1]);
 assert.deepEqual(depthOrder(order,positions),order);
 assert.deepEqual(layerPositions([9]),{'9':0});
});
test('moving one layer across others freezes their positions and equal positions retain order',()=>{
 const order=[3,2,1],positions=changeLayerPosition(order,{},3,.8);
 assert.deepEqual(positions,{'3':.8,'2':.5,'1':1});
 const next=depthOrder(order,positions);assert.deepEqual(next,[2,3,1]);
 assert.deepEqual(layerPositions(next,positions),positions);
 assert.deepEqual(depthOrder(order,{'3':.5,'2':.5,'1':.5}),order);
});
test('dragging reassigns existing depth slots and uniform reset still follows the new order',()=>{
 const order=[3,2,1],next=[1,3,2];
 const reassigned=reorderedPositions(order,next,{'3':.1,'2':.4,'1':.9});
 assert.deepEqual(reassigned,{'1':.1,'3':.4,'2':.9});
 assert.deepEqual(depthOrder(next,reassigned),next);
 assert.deepEqual(reorderedPositions(order,next,{}),{});
 assert.deepEqual(layerPositions(next,{}),{'1':0,'3':.5,'2':1});
});
