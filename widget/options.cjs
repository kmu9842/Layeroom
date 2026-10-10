const sizes={small:{width:240,height:320},medium:{width:320,height:420},large:{width:440,height:570}};
function options(value={},defaults={}){
 return {autoRotate:typeof value.autoRotate==='boolean'?value.autoRotate:Boolean(defaults.autoRotate),followMouse:typeof value.followMouse==='boolean'?value.followMouse:defaults.followMouse!==false,size:Object.hasOwn(sizes,value.size)?value.size:'medium'};
}
function configure(current,patch){
 if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('Invalid widget options');
 for(const [key,value] of Object.entries(patch)){
  if(!['autoRotate','followMouse','size'].includes(key))throw Error('Only widget options can be changed');
  if(key==='size'?!Object.hasOwn(sizes,value):typeof value!=='boolean')throw Error('Invalid widget option');
 }
 return {...current,...patch};
}
function bounds(size,workArea,previous){
 const target=sizes[size]||sizes.medium,scale=Math.min(1,(workArea.width-24)/target.width,(workArea.height-24)/target.height),width=Math.round(target.width*scale),height=Math.round(target.height*scale);
 const x=previous?previous.x+(previous.width||width)-width:workArea.x+workArea.width-width-18,y=previous?previous.y+(previous.height||height)-height:workArea.y+workArea.height-height-18;
 return {x:Math.round(Math.max(workArea.x,Math.min(workArea.x+workArea.width-width,x))),y:Math.round(Math.max(workArea.y,Math.min(workArea.y+workArea.height-height,y))),width,height};
}
module.exports={sizes,options,configure,bounds};
