// Label IDs are categorical: never antialias or blend their numeric values.
// Only alpha is feathered. Strokes and history touch small 64px tiles.
export class PaintEngine {
 constructor(width,height,source,alpha,labels,regions){
  Object.assign(this,{width,height,source,alpha,labels});
  this.palette=new Uint8Array(256*3);regions.forEach((r,i)=>this.setColor(i+1,r.color));
  this.output=new Uint8ClampedArray(width*height*4);this.undoStack=[];this.redoStack=[];this.stroke=null;this.historyBytes=0;
 }
 setColor(id,color){const hex=color.slice(1);for(let k=0;k<3;k++)this.palette[id*3+k]=parseInt(hex.slice(k*2,k*2+2),16);}
 begin(){if(!this.stroke)this.stroke=new Map();}
 tile(index){const tx=index%Math.ceil(this.width/64),ty=Math.floor(index/Math.ceil(this.width/64));return{x:tx*64,y:ty*64,w:Math.min(64,this.width-tx*64),h:Math.min(64,this.height-ty*64)};}
 snapshot(box){const data=new Uint8Array(box.w*box.h*2);for(let y=0;y<box.h;y++)for(let x=0;x<box.w;x++){const p=(box.y+y)*this.width+box.x+x,q=(y*box.w+x)*2;data[q]=this.alpha[p];data[q+1]=this.labels[p];}return data;}
 remember(x,y){const id=Math.floor(y/64)*Math.ceil(this.width/64)+Math.floor(x/64);if(!this.stroke.has(id)){const box=this.tile(id);this.stroke.set(id,{box,before:this.snapshot(box)});}}
 paint(from,to,{tool,part,size,hardness=1}){
  if(!this.stroke)this.begin();const r=Math.max(.5,size/2),box={x:Math.max(0,Math.floor(Math.min(from.x,to.x)-r-1)),y:Math.max(0,Math.floor(Math.min(from.y,to.y)-r-1))};
  box.w=Math.max(0,Math.min(this.width,Math.ceil(Math.max(from.x,to.x)+r+1))-box.x);box.h=Math.max(0,Math.min(this.height,Math.ceil(Math.max(from.y,to.y)+r+1))-box.y);
  const dx=to.x-from.x,dy=to.y-from.y,length=dx*dx+dy*dy,inner=r*hardness;
  let changed=false;
  for(let y=box.y;y<box.y+box.h;y++)for(let x=box.x;x<box.x+box.w;x++){
   const t=length?Math.max(0,Math.min(1,((x+.5-from.x)*dx+(y+.5-from.y)*dy)/length)):0;
   const distance=Math.hypot(x+.5-from.x-t*dx,y+.5-from.y-t*dy);if(distance>r)continue;
   const p=y*this.width+x,oldA=this.alpha[p],oldL=this.labels[p];let a=oldA,l=oldL;
   if(tool==='part'){if(!a)continue;l=part;}
   else{const coverage=hardness>=.99?1:Math.max(0,Math.min(1,(r-distance)/Math.max(.01,r-inner)));
    if(tool==='erase'){a=Math.min(a,Math.round(255*(1-coverage)));if(!a)l=0;}
    else if(tool==='restore'){a=Math.max(a,Math.round(255*coverage));if(a)l=part;}
   }
   if(a===oldA&&l===oldL)continue;this.remember(x,y);this.alpha[p]=a;this.labels[p]=l;changed=true;
  }
  return changed?box:null;
 }
 commit(){if(!this.stroke)return false;const tiles=[...this.stroke.values()];this.stroke=null;if(!tiles.length)return false;for(const t of tiles)t.after=this.snapshot(t.box);const bytes=tiles.reduce((n,t)=>n+t.before.byteLength+t.after.byteLength,0);this.undoStack.push({tiles,bytes});this.redoStack=[];this.historyBytes+=bytes;while(this.undoStack.length>50||(this.historyBytes>32*1024*1024&&this.undoStack.length>1)){this.historyBytes-=this.undoStack.shift().bytes;}return true;}
 restore(entry,side){let box=null;for(const tile of entry.tiles){const {x,y,w,h}=tile.box,data=tile[side];for(let row=0;row<h;row++)for(let col=0;col<w;col++){const p=(y+row)*this.width+x+col,q=(row*w+col)*2;this.alpha[p]=data[q];this.labels[p]=data[q+1];}box=union(box,tile.box);}return box;}
 undo(){this.commit();const entry=this.undoStack.pop();if(!entry)return null;this.historyBytes-=entry.bytes;this.redoStack.push(entry);return this.restore(entry,'before');}
 redo(){const entry=this.redoStack.pop();if(!entry)return null;this.historyBytes+=entry.bytes;this.undoStack.push(entry);return this.restore(entry,'after');}
 render(box={x:0,y:0,w:this.width,h:this.height},mode='overlay',opacity=.55){
  for(let y=box.y;y<box.y+box.h;y++)for(let x=box.x;x<box.x+box.w;x++){
   const p=y*this.width+x,q=p*4,id=this.labels[p],mix=mode==='original'?0:mode==='mask'?1:opacity;
   for(let k=0;k<3;k++)this.output[q+k]=Math.round(this.source[q+k]*(1-mix)+this.palette[id*3+k]*mix);
   this.output[q+3]=mode==='original'?255:this.alpha[p];
  }return this.output;
 }
 sample(x,y){return x>=0&&y>=0&&x<this.width&&y<this.height?this.labels[Math.floor(y)*this.width+Math.floor(x)]:0;}
}
export function union(a,b){if(!a)return b?{...b}:null;if(!b)return a;const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return{x,y,w:Math.max(a.x+a.w,b.x+b.w)-x,h:Math.max(a.y+a.h,b.y+b.h)-y};}
