import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';
import {appearance} from './frameThemes';
import {layerPositions,depthOrder} from './layerDepth';
function rounded(w,h,r){
 const s=new THREE.Shape(),x=-w/2,y=-h/2;
 s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;
}
function ringGeometry(depth,bevel=false){
 const outer=rounded(3.84,4.84,.12),inner=rounded(3.58,4.58,.06);outer.holes.push(new THREE.Path(inner.getPoints()));
 return new THREE.ExtrudeGeometry(outer,{depth,bevelEnabled:bevel,bevelSegments:2,steps:1,bevelSize:.018,bevelThickness:.012,curveSegments:10});
}
function plateTexture(style){
 const c=document.createElement('canvas');c.width=512;c.height=640;const x=c.getContext('2d'),colors=style.colors;
 x.fillStyle=colors[0];
 if(style.pattern==='gradient'){const g=x.createRadialGradient(256,280,0,256,280,430);g.addColorStop(0,colors[1]);g.addColorStop(1,colors[0]);x.fillStyle=g;}x.fillRect(0,0,512,640);
 if(style.pattern==='linen'||style.pattern==='grid'){const step=style.pattern==='linen'?4:48;x.strokeStyle=colors[1];x.globalAlpha=style.pattern==='linen'?.23:.5;x.lineWidth=1;x.beginPath();for(let i=0;i<640;i+=step){x.moveTo(i,0);x.lineTo(i,640);x.moveTo(0,i);x.lineTo(512,i);}x.stroke();x.globalAlpha=1;}
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
const loadImage=url=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=url;});
function texture(im){const t=new THREE.Texture(im);t.needsUpdate=true;t.colorSpace=THREE.SRGBColorSpace;return t;}

function paperWalls(contours,pw,ph){
 const positions=[],uvs=[];
 for(const loop of contours.loops){
  for(let i=0;i<loop.length;i++){
   const a=loop[i],b=loop[(i+1)%loop.length];
   const au=(a[0]+.5)/contours.width,av=1-(a[1]+.5)/contours.height,bu=(b[0]+.5)/contours.width,bv=1-(b[1]+.5)/contours.height;
   const ax=(au-.5)*pw,ay=(av-.5)*ph,bx=(bu-.5)*pw,by=(bv-.5)*ph;
   positions.push(ax,ay,0,bx,by,0,ax,ay,-1,bx,by,0,bx,by,-1,ax,ay,-1);
   uvs.push(au,av,bu,bv,au,av,bu,bv,bu,bv,au,av);
  }
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.computeVertexNormals();return g;
}
function paperMaterial(map){
 const material=new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide});
 material.onBeforeCompile=shader=>{
  shader.uniforms.paperDepth={value:1};material.userData.depthUniform=shader.uniforms.paperDepth;
  shader.vertexShader='varying float paperZ;\nuniform float paperDepth;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\npaperZ = position.z * paperDepth;');
  shader.fragmentShader='varying float paperZ;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\nfloat phase = paperZ/0.04;\nfloat line = 1.0-smoothstep(0.04,0.11+fwidth(phase),abs(fract(phase)-0.5));\ndiffuseColor.rgb = mix(diffuseColor.rgb * 0.66, vec3(0.30,0.255,0.19),line*0.35);\ndiffuseColor.a = 1.0;');
 };
 return material;
}

const Viewer=forwardRef(function Viewer({card,settings,mode,hidden,autoRotate,zoom,theme,paused=false,interactive=true,onReady},ref){
 const host=useRef(null),state=useRef(null),props=useRef(null),[error,setError]=useState('');props.current={settings,mode,hidden,autoRotate,zoom,theme,paused};
 useImperativeHandle(ref,()=>({
  capture(){return state.current?.renderer.domElement.toDataURL('image/png');},
  pointAt(x,y){if(state.current)state.current.pointer={x:THREE.MathUtils.clamp(x,-1,1),y:THREE.MathUtils.clamp(y,-1,1)};},
  reset(){if(state.current){state.current.target={x:.02,y:-.1};state.current.dragged=false;}},
  front(){if(state.current){state.current.target={x:0,y:0};state.current.group.rotation.set(0,0,0);state.current.dragged=true;}}
 }));
 useEffect(()=>{
  if(!card)return;let disposed=false,raf=0;setError('');const el=host.current;let renderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});}catch{setError('WebGL을 사용할 수 없어 평면 미리보기를 표시합니다.');onReady?.();return;}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;el.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-3,3,3,-3,.1,200);camera.position.z=100;
  const group=new THREE.Group();scene.add(group);scene.add(new THREE.AmbientLight(0xffffff,2));
  const light=new THREE.DirectionalLight(0xffefd4,3.4);light.position.set(-3,5,6);scene.add(light);
  const rim=new THREE.DirectionalLight(0xb8d4ff,1.5);rim.position.set(4,-2,2);scene.add(rim);
  const metal=new THREE.MeshStandardMaterial({color:0xb5a489,roughness:.34,metalness:.75});
  const wallMaterial=new THREE.MeshStandardMaterial({color:0x81745e,roughness:.75,metalness:.15,side:THREE.DoubleSide});
  const walls=new THREE.Mesh(ringGeometry(1),wallMaterial);group.add(walls);
  const frontRim=new THREE.Mesh(ringGeometry(.065,true),metal);frontRim.position.z=.012;group.add(frontRim);
  const backRim=new THREE.Mesh(ringGeometry(.05,true),metal);group.add(backRim);
  const back=new THREE.Mesh(new THREE.PlaneGeometry(3.64,4.64),new THREE.MeshBasicMaterial({map:plateTexture(appearance(settings,theme)),side:THREE.DoubleSide}));group.add(back);
  const layerGroup=new THREE.Group();group.add(layerGroup);
  const ctx={renderer,group,target:{x:.02,y:-.1},dragged:false};state.current=ctx;
  const layerMeshes=new Map(),shadowMeshes=new Map(),supportMeshes=new Map(),resources=[];
  let preview,originalTex,segmentTex,depthTex,aspect=1,lastAppearance='',lastLayout='',cavity=1;
  const base=`/assets/${card.id}/`,suffix=`?v=${card.updated_at}`;
  Promise.all([
   Promise.all(['source.png','depth.png','cutout.png','segments.png',...card.layers.map(l=>settings.edge_smoothing&&l.render_file?l.render_file:l.file)].map(f=>loadImage(base+f+suffix))),
   Promise.all(card.layers.map(l=>l.contour_file?fetch(base+l.contour_file+suffix).then(r=>{if(!r.ok)throw Error('contour');return r.json();}):null))
  ]).then(([images,contours])=>{
   if(disposed)return;
   const [source,depth,cutout,segments,...layerImages]=images;
   const w=card.width,h=card.height,scale=Math.min(3.32/w,4.10/h),pw=w*scale,ph=h*scale;
   const geometry=new THREE.PlaneGeometry(pw,ph);
   originalTex=texture(source);segmentTex=texture(segments);resources.push(originalTex,segmentTex);
   const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.drawImage(depth,0,0);x.globalCompositeOperation='destination-in';x.drawImage(cutout,0,0);depthTex=new THREE.CanvasTexture(c);depthTex.colorSpace=THREE.SRGBColorSpace;resources.push(depthTex);
   preview=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:originalTex,transparent:true,depthWrite:false,side:THREE.DoubleSide}));preview.position.z=.003;group.add(preview);
   card.layers.forEach((layer,i)=>{
    const tex=texture(layerImages[i]);resources.push(tex);
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:tex,transparent:true,side:THREE.DoubleSide,depthWrite:false,alphaTest:.002}));
    layerGroup.add(mesh);layerMeshes.set(layer.id,mesh);
    if(contours[i]){const support=new THREE.Mesh(paperWalls(contours[i],pw,ph),paperMaterial(tex));layerGroup.add(support);supportMeshes.set(layer.id,support);}
    const shadow=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:tex,color:0x000000,transparent:true,opacity:.12,depthWrite:false,alphaTest:.002}));shadowMeshes.set(layer.id,shadow);layerGroup.add(shadow);
   });onReady?.();
  }).catch(()=>{if(!disposed){setError('이미지를 불러오지 못했습니다.');onReady?.();}});
  function resize(){const {width,height}=el.getBoundingClientRect();renderer.setSize(width,height);aspect=width/Math.max(1,height);lastLayout='';}
  const observer=new ResizeObserver(resize);observer.observe(el);resize();
  let dragging=false,previous={x:0,y:0};
  const down=e=>{dragging=true;ctx.dragged=true;previous={x:e.clientX,y:e.clientY};el.setPointerCapture(e.pointerId);};
  const move=e=>{const p=props.current,limit=p.settings.angle_limit*Math.PI/180;
   if(dragging){ctx.target.y=THREE.MathUtils.clamp(ctx.target.y+(e.clientX-previous.x)*.005,-limit,limit);ctx.target.x=THREE.MathUtils.clamp(ctx.target.x+(e.clientY-previous.y)*.005,-limit*.8,limit*.8);previous={x:e.clientX,y:e.clientY};}
   else if(p.settings.tilt&&!ctx.dragged){const r=el.getBoundingClientRect();ctx.target.y=((e.clientX-r.left)/r.width-.5)*limit*1.25;ctx.target.x=((e.clientY-r.top)/r.height-.5)*limit*.8;}
  };
  const up=()=>{dragging=false;},leave=()=>{if(!ctx.dragged){ctx.target.x=.02;ctx.target.y=-.1;}};
  if(interactive){el.addEventListener('pointerdown',down);el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);el.addEventListener('pointerleave',leave);}
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
  function frame(t){if(disposed)return;const p=props.current,s=p.settings,exploded=p.mode==='layers',is3D=p.mode==='relief'||exploded;
   el.dataset.paused=String(p.paused);if(p.paused){raf=requestAnimationFrame(frame);return;}
   const baseOrder=s.layer_order||card.layers.map(l=>l.id).reverse(),positions=layerPositions(baseOrder,s.layer_z),order=depthOrder(baseOrder,positions),gap=Math.max(0,Math.min(.1,s.layer_gap??.025));
   const signature=[gap,order.join(','),order.map(id=>positions[id]).join(','),aspect,exploded,s.angle_limit].join('|');
   if(signature!==lastLayout){
    cavity=Math.max(0,(order.length-1)*gap);
    walls.scale.z=cavity+.02;walls.position.z=-cavity-.02;back.position.z=-cavity-.016;backRim.position.z=-cavity-.07;
    const limit=s.angle_limit*Math.PI/180,projectedWidth=Math.max(3.84,3.84*Math.cos(limit)+cavity*Math.sin(limit)),projectedHeight=Math.max(4.84,4.84*Math.cos(limit*.8)+cavity*Math.sin(limit*.8));
    const vertical=Math.max(5.7,projectedHeight+.8,(projectedWidth+.9)/aspect);
    camera.left=-vertical*aspect/2;camera.right=vertical*aspect/2;camera.top=vertical/2;camera.bottom=-vertical/2;camera.updateProjectionMatrix();
    el.dataset.layerOrder=order.join(',');el.dataset.frontZ='0';el.dataset.backZ=String(order.length>1?-cavity:0);el.dataset.frameDepth=String(cavity);lastLayout=signature;
    el.dataset.layerZ=JSON.stringify(Object.fromEntries(order.map(id=>[id,-positions[id]*cavity])));
   }
   const limit=s.angle_limit*Math.PI/180;
   let rx=THREE.MathUtils.clamp(ctx.target.x,-limit*.8,limit*.8),ry=THREE.MathUtils.clamp(ctx.target.y,-limit,limit);
   if(p.autoRotate&&!reduce.matches){rx=Math.sin(t*.00055)*limit*.24;ry=Math.sin(t*.00045)*limit*.85;}
   if(!interactive&&ctx.pointer&&s.tilt&&!reduce.matches){const weight=p.autoRotate?.28:.65;rx=THREE.MathUtils.clamp((p.autoRotate?rx:0)+ctx.pointer.y*limit*weight*.7,-limit*.8,limit*.8);ry=THREE.MathUtils.clamp((p.autoRotate?ry:0)+ctx.pointer.x*limit*weight,-limit,limit);}
   if(!is3D){rx=0;ry=0;}else if(exploded&&!ctx.dragged&&!p.autoRotate){ry=-Math.min(limit,.58);}
   group.rotation.set(rx,ry,0);group.scale.setScalar(p.zoom);
   // Centre the physical cavity while rotating; layer coordinates remain [-depth, 0].
   group.position.set(Math.sin(group.rotation.y)*cavity/2*p.zoom,-Math.sin(group.rotation.x)*Math.cos(group.rotation.y)*cavity/2*p.zoom,cavity/2);
   el.dataset.rotationY=String(group.rotation.y);
   if(preview){preview.visible=!is3D;preview.material.map=p.mode==='mask'?segmentTex:p.mode==='depth'?depthTex:originalTex;layerGroup.visible=is3D;
    const phase=t*.001*Math.PI*2/s.motion_duration;
    const breath=s.breathing&&!reduce.matches?Math.sin(phase)*s.motion_amount:0;
    const sway=s.breathing&&!reduce.matches?Math.sin(phase+.9)*s.motion_amount:0;
    order.forEach((id,i)=>{
     const m=layerMeshes.get(id),shadow=shadowMeshes.get(id);if(!m)return;
     const selected=s.layer_motion?.[String(id)],motion=selected?breath:0,side=selected?sway:0;
     const z=-positions[id]*cavity,nextGap=i<order.length-1?(positions[order[i+1]]-positions[id])*cavity:0;
     m.visible=!p.hidden.has(id);m.position.set(side*.006,motion*.011,z);m.rotation.z=motion*.0012;m.renderOrder=(order.length-i)*2;
     const support=supportMeshes.get(id);
     if(support){const thickness=Math.max(0,cavity+z-.003);support.visible=m.visible&&Boolean(s.support_layers)&&!exploded&&thickness>.005;support.position.copy(m.position);support.rotation.copy(m.rotation);support.scale.z=thickness;if(support.material.userData.depthUniform)support.material.userData.depthUniform.value=thickness;}
     shadow.visible=m.visible&&nextGap>0;shadow.position.set(m.position.x+.007,m.position.y-.009,z-Math.min(.02,nextGap*.3));shadow.rotation.z=m.rotation.z;shadow.material.opacity=.07;shadow.renderOrder=m.renderOrder-1;
    });el.dataset.breathing=String(Boolean(s.breathing&&!reduce.matches));el.dataset.supports=String([...supportMeshes.values()].filter(m=>m.visible).length);
   }
   walls.visible=frontRim.visible=backRim.visible=back.visible=!exploded;
   const style=appearance(s,p.theme),key=JSON.stringify(style);
   if(lastAppearance!==key){
    lastAppearance=key;back.material.map.dispose();back.material.map=plateTexture(style);
    metal.color.set(style.frame);metal.metalness=style.metalness;metal.roughness=style.metalness>.4?.34:.72;wallMaterial.color.set(style.frame).multiplyScalar(.68);
    el.dataset.frameTheme=s.frame_theme||s.frame;el.dataset.frameColor=style.frame;el.dataset.backgroundStyle=style.pattern;
    if(style.pattern==='image'&&style.image){el.dataset.backgroundReady='false';loadImage(base+style.image).then(im=>{if(disposed||lastAppearance!==key)return;const canvas=back.material.map.image,context=canvas.getContext('2d'),scale=Math.max(canvas.width/im.width,canvas.height/im.height);context.drawImage(im,(canvas.width-im.width*scale)/2,(canvas.height-im.height*scale)/2,im.width*scale,im.height*scale);back.material.map.needsUpdate=true;el.dataset.backgroundReady='true';}).catch(()=>{if(!disposed&&lastAppearance===key)el.dataset.backgroundReady='error';});}
   }
   renderer.render(scene,camera);raf=requestAnimationFrame(frame);
  }raf=requestAnimationFrame(frame);
  return()=>{disposed=true;cancelAnimationFrame(raf);observer.disconnect();el.removeEventListener('pointerdown',down);el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',up);el.removeEventListener('pointerleave',leave);const geoms=new Set(),mats=new Set();scene.traverse(o=>{if(o.geometry)geoms.add(o.geometry);if(o.material)mats.add(o.material);});geoms.forEach(g=>g.dispose());mats.forEach(m=>{m.map?.dispose();m.dispose();});resources.forEach(r=>r.dispose());renderer.dispose();renderer.domElement.remove();state.current=null;};
 },[card?.id,card?.updated_at,settings.edge_smoothing,interactive]);
 return <div className="viewer-host" ref={host} aria-label="드래그해서 회전하는 3D 캐릭터 액자">{error&&<div className="viewer-error"><img src={`/assets/${card.id}/cutout.png`} alt={card.title}/><p>{error}</p></div>}</div>;
});
export default Viewer;
