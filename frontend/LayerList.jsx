import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {DndContext,DragOverlay,closestCenter,MouseSensor,TouchSensor,KeyboardSensor,useSensor,useSensors} from '@dnd-kit/core';
import {SortableContext,useSortable,arrayMove,verticalListSortingStrategy,sortableKeyboardCoordinates} from '@dnd-kit/sortable';
import {CSS} from '@dnd-kit/utilities';
import {GripVertical,Eye,EyeOff} from 'lucide-react';

function LayerContent({layer,card}){
 return <><GripVertical size={15}/><span className="layer-thumbnail"><img draggable="false" src={`/assets/${card.id}/${layer.render_file||layer.file}?v=${card.updated_at}`} alt=""/></span><span className="layer-name" title={[...(layer.group_path||[]),layer.name].join(' / ')}>{layer.name}</span></>;
}
function PositionControl({layer,value,enabled,onPosition,onCommit}){
 const [draft,setDraft]=useState((value*100).toFixed(1)),editing=useRef(false);
 useEffect(()=>{if(!editing.current)setDraft((value*100).toFixed(1));},[value]);
 const finish=()=>{editing.current=false;setDraft((value*100).toFixed(1));onCommit();};
 return <div className="layer-position-control" id={`layer-z-${layer.id}`}>
  <label htmlFor={`layer-z-range-${layer.id}`}>Z 위치</label><div className="layer-position-number"><input type="number" aria-label={`${layer.name} Z 위치 값`} min="0" max="100" step="0.1" value={draft} disabled={!enabled} onFocus={()=>{editing.current=true;}} onChange={e=>{const text=e.target.value;setDraft(text);const n=Number(text);if(text!==''&&Number.isFinite(n)&&n>=0&&n<=100)onPosition(layer.id,n/100);}} onBlur={finish} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/><span>%</span></div>
  <input id={`layer-z-range-${layer.id}`} aria-label={`${layer.name} Z 위치`} type="range" min="0" max="100" step="0.1" value={value*100} disabled={!enabled} onChange={e=>onPosition(layer.id,+e.target.value/100)} onPointerUp={onCommit} onPointerCancel={onCommit} onBlur={onCommit}/>
  <div className="layer-position-ends"><span>앞면 0%</span><span>뒷면 100%</span></div>
  {!enabled&&<p>레이어가 2개 이상이고 Z축 간격이 0보다 커야 조절할 수 있습니다.</p>}
 </div>;
}
function Row({layer,card,hidden,motion,toggleLayer,toggleMotion,dropSide,position,positionOpen,onPositionOpen,depthEnabled,onPosition,onPositionCommit}){
 const {attributes,listeners,setNodeRef,setActivatorNodeRef,transform,transition,isDragging}=useSortable({id:layer.id});
 return <div ref={setNodeRef} style={{transform:CSS.Transform.toString(transform),transition}} className={`layer-row sortable-layer ${positionOpen?'position-open':''} ${hidden?'muted':''} ${isDragging?'drag-origin':''} ${dropSide?'drop-'+dropSide:''}`} data-layer-id={layer.id} role="listitem"><div className="layer-main-row">
  <button className="layer-drag-handle" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`${layer.name} 순서 이동`} title="드래그로 순서 변경 · Space로 잡고 방향키로 이동"><LayerContent layer={layer} card={card}/></button>
  <label className="layer-motion-check" title={motion?'움직임':'고정'}><input type="checkbox" checked={motion} onChange={()=>toggleMotion(layer.id)} aria-label={`${layer.name} 움직임`}/></label>
  <button className="layer-z-toggle" onClick={()=>onPositionOpen(layer.id)} aria-label={`${layer.name} Z 위치 조절`} aria-expanded={positionOpen} aria-controls={`layer-z-${layer.id}`} title={`Z 위치 ${(position*100).toFixed(1)}%`}>Z</button>
  <button onClick={()=>toggleLayer(layer.id)} aria-label={`${layer.name} ${hidden?'표시':'숨기기'}`} title={hidden?'표시':'숨기기'}>{hidden?<EyeOff size={15}/>:<Eye size={15}/>}</button>
 </div>{positionOpen&&<PositionControl layer={layer} value={position} enabled={depthEnabled} onPosition={onPosition} onCommit={onPositionCommit}/>}</div>;
}
export default function LayerList({card,order,hidden,motion,onOrder,toggleLayer,toggleMotion,positions,depthEnabled,onPosition,onPositionCommit}){
 const [active,setActive]=useState(null),[over,setOver]=useState(null),[positionId,setPositionId]=useState(null);
 const sensors=useSensors(useSensor(MouseSensor,{activationConstraint:{distance:5}}),useSensor(TouchSensor,{activationConstraint:{delay:180,tolerance:5}}),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}));
 const layers=order.map(id=>card.layers.find(l=>l.id===id)).filter(Boolean),dragged=layers.find(l=>l.id===active);
 const clear=()=>{setActive(null);setOver(null);};
 const label=id=>card.layers.find(l=>l.id===id)?.name||'레이어';
 return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={({active})=>{setActive(active.id);setOver(active.id);}} onDragOver={({over})=>setOver(over?.id??null)} onDragCancel={clear} onDragEnd={({active,over})=>{if(over&&active.id!==over.id)onOrder(arrayMove(order,order.indexOf(active.id),order.indexOf(over.id)));clear();}} accessibility={{screenReaderInstructions:{draggable:'스페이스 키로 레이어를 잡고 위아래 방향키로 이동하세요. 다시 스페이스 키로 놓거나 Escape로 취소하세요.'},announcements:{onDragStart:({active})=>`${label(active.id)} 이동 시작`,onDragOver:({over})=>over?`${order.indexOf(over.id)+1}번째 위치`:'목록 밖',onDragEnd:({active,over})=>over?`${label(active.id)}, ${order.indexOf(over.id)+1}번째로 이동`:'이동 취소',onDragCancel:()=> '이동 취소'}}}>
  <SortableContext items={order} strategy={verticalListSortingStrategy}><div className="layer-list" role="list" aria-label="앞에서 뒤 순서의 레이어">
   {layers.map(layer=><Row key={layer.id} layer={layer} card={card} hidden={hidden.has(layer.id)} motion={!!motion?.[String(layer.id)]} toggleLayer={toggleLayer} toggleMotion={toggleMotion} position={positions[layer.id]} positionOpen={positionId===layer.id} onPositionOpen={id=>{onPositionCommit();setPositionId(current=>current===id?null:id);}} depthEnabled={depthEnabled} onPosition={onPosition} onPositionCommit={onPositionCommit} dropSide={active!==over&&over===layer.id?(order.indexOf(active)<order.indexOf(over)?'after':'before'):null}/>)}</div></SortableContext>
  {createPortal(<DragOverlay dropAnimation={{duration:160,easing:'ease-out'}}>{dragged?<div className="layer-row layer-drag-overlay"><LayerContent layer={dragged} card={card}/></div>:null}</DragOverlay>,document.body)}
 </DndContext>;
}
