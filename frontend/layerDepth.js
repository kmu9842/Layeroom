// Positions are fractions of the frame cavity: 0 = front, 1 = back.
export function layerPositions(order, saved = {}) {
 return Object.fromEntries(order.map((id,index)=>[String(id), Number.isFinite(saved?.[id]) ? Math.max(0,Math.min(1,saved[id])) : index/Math.max(1,order.length-1)]));
}
export function depthOrder(order, positions) {
 return [...order].sort((a,b)=>positions[a]-positions[b]); // Equal depths retain the user's / PSD order.
}
export function changeLayerPosition(order,saved,id,value) {
 return {...layerPositions(order,saved),[String(id)]:Math.max(0,Math.min(1,value))};
}
export function reorderedPositions(order,nextOrder,saved) {
 if(!Object.keys(saved||{}).length)return {};
 const positions=layerPositions(order,saved),slots=order.map(id=>positions[id]).sort((a,b)=>a-b);
 return Object.fromEntries(nextOrder.map((id,index)=>[String(id),slots[index]]));
}
