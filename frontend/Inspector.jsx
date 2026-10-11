import {Check,Waves,Loader2,ImagePlus,ArrowDownToLine,SlidersHorizontal,PanelsTopLeft} from 'lucide-react';
import LayerList from './LayerList';
import ThemePicker from './ThemePicker';
import {layerPositions,depthOrder,changeLayerPosition,reorderedPositions} from './layerDepth';

export default function Inspector({card,settings,setSettings,hidden,toggleLayer,onEdit,onSave,onWidget,widgetBusy,capture,saving,ready}){
 const update=patch=>setSettings(current=>({...current,...patch}));
 const order=settings.layer_order||card.layers.map(l=>l.id).reverse();
 const layers=order.map(id=>card.layers.find(l=>l.id===id)).filter(Boolean);
 const positions=layerPositions(order,settings.layer_z);
 const changeOrder=layer_order=>setSettings(current=>({...current,layer_order,layer_z:reorderedPositions(current.layer_order||order,layer_order,current.layer_z)}));
 const changePosition=(id,value)=>setSettings(current=>({...current,layer_z:changeLayerPosition(current.layer_order||order,current.layer_z,id,value)}));
 const commitPosition=()=>setSettings(current=>({...current,layer_order:depthOrder(current.layer_order||order,layerPositions(current.layer_order||order,current.layer_z))}));
 return <aside className="inspector">
  <div className="inspector-heading"><h2>액자 설정</h2></div>
  <div className="inspector-scroll">
  <section className="panel-section">
   <label className="field-label" htmlFor="layer-gap">Z축 레이어 간격 <span>{settings.layer_gap.toFixed(3)}</span></label>
   <input id="layer-gap" type="range" min="0" max="0.1" step="0.005" value={settings.layer_gap} onChange={e=>update({layer_gap:+e.target.value})}/>
   <div className="range-labels"><span>좁게</span><span>넓게</span></div>
   <label className="toggle-row" htmlFor="support-layers">종이 보조층<input id="support-layers" className="switch" type="checkbox" checked={settings.support_layers??true} onChange={e=>update({support_layers:e.target.checked})}/></label>
   <label className="field-label spaced" htmlFor="angle-limit">회전 한도 <span>±{settings.angle_limit}°</span></label>
   <input id="angle-limit" type="range" min="15" max="65" step="1" value={settings.angle_limit} onChange={e=>update({angle_limit:+e.target.value})}/>
   <label className="toggle-row" htmlFor="tilt-toggle">마우스 시차<input id="tilt-toggle" className="switch" type="checkbox" checked={settings.tilt} onChange={e=>update({tilt:e.target.checked})}/></label>
  </section>
  <section className="panel-section motion-section">
   <label className="toggle-row" htmlFor="breathing-toggle"><span><Waves size={14}/> 레이어 움직임</span><input id="breathing-toggle" className="switch" type="checkbox" checked={settings.breathing} onChange={e=>update({breathing:e.target.checked})}/></label>
   {settings.breathing&&<div className="motion-sliders"><label htmlFor="motion-amount">흔들림 {settings.motion_amount.toFixed(1)}<input id="motion-amount" type="range" min=".1" max="2" step=".1" value={settings.motion_amount} onChange={e=>update({motion_amount:+e.target.value})}/></label><label htmlFor="motion-duration">주기 {settings.motion_duration}초<input id="motion-duration" type="range" min="3" max="12" step="1" value={settings.motion_duration} onChange={e=>update({motion_duration:+e.target.value})}/></label></div>}
  </section>
  <section className="panel-section appearance-section"><ThemePicker key={card.id} card={card} settings={settings} update={update}/></section>
  <section className="panel-section layers-section"><div className="section-label"><span>{card.segmentation==='psd'?'PSD 레이어':'분리된 레이어'} <b>{layers.length}</b></span></div>
   {card.segmentation!=='psd'&&<button className="boundary-edit-button" onClick={onEdit}><SlidersHorizontal size={18}/>경계 수정</button>}
   <div className="layer-guide"><span>위 = 앞면 · 드래그로 순서 변경</span><span>움직임</span></div>
   {card.segmentation!=='psd'&&<label className="toggle-row edge-toggle" htmlFor="edge-smoothing">절단 경계 부드럽게<input id="edge-smoothing" className="switch" type="checkbox" checked={settings.edge_smoothing??true} onChange={e=>update({edge_smoothing:e.target.checked})}/></label>}
   <LayerList key={card.id} card={card} order={order} hidden={hidden} motion={settings.layer_motion} positions={positions} depthEnabled={settings.layer_gap>0&&order.length>1} onPosition={changePosition} onPositionCommit={commitPosition} onOrder={changeOrder} toggleLayer={toggleLayer} toggleMotion={id=>update({layer_motion:{...settings.layer_motion,[String(id)]:!settings.layer_motion?.[String(id)]}})}/>
   <p className="layer-footnote"><button onClick={()=>update({layer_z:{}})} disabled={!Object.keys(settings.layer_z||{}).length}>Z 위치 균등 배치</button><button onClick={()=>update({layer_order:card.layers.map(l=>l.id).reverse(),layer_z:{}})}>원본 순서 복원</button></p>
   {card.warnings?.length>0&&<details className="import-notes"><summary>PSD 가져오기 안내 ({card.warnings.length})</summary>{card.warnings.map((w,i)=><p key={i}>{w}</p>)}</details>}
  </section>
  </div><div className="panel-actions"><div className="save-widget-row"><button className="save-button" onClick={onSave} disabled={saving}>{saving?<Loader2 className="spin" size={15}/>:<Check size={15}/>}액자 설정 저장</button><button className="widget-download" onClick={onWidget} disabled={widgetBusy||!ready} title="현재 설정으로 Windows 위젯 EXE 받기">{widgetBusy?<Loader2 className="spin" size={15}/>:<PanelsTopLeft size={15}/>}위젯으로 받기</button></div><div className="export-row"><button onClick={capture} disabled={!ready}><ImagePlus size={14}/>액자 PNG</button><a href={`/api/cards/${card.id}/export`} download><ArrowDownToLine size={14}/>레이어 ZIP</a></div></div>
 </aside>;
}
