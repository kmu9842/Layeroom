import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Settings,X,GripHorizontal} from 'lucide-react';
import Viewer from '../frontend/Viewer';
import './widget.css';

function Widget(){
 const [data,setData]=useState(null),[options,setOptions]=useState(null),[open,setOpen]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(''),viewer=useRef(null);
 useEffect(()=>{let active=true;window.widget.initialize().then(value=>{if(active){setData(value.snapshot);setOptions(value.options);document.title=value.snapshot.card.title;document.documentElement.dataset.theme=value.snapshot.theme;}}).catch(()=>setError('위젯 데이터를 읽지 못했습니다.'));
  const offOptions=window.widget.onOptions(setOptions),offPointer=window.widget.onPointer(p=>viewer.current?.pointAt(p.x,p.y)),offSettings=window.widget.onSettings(()=>setOpen(v=>!v));
  return()=>{active=false;offOptions();offPointer();offSettings();};},[]);
 useEffect(()=>{const key=e=>{if(e.key==='Escape')setOpen(false);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 async function update(patch){try{setOptions(await window.widget.configure(patch));setError('');}catch{setError('설정을 저장하지 못했습니다.');}}
 if(!data||!options)return <div className="widget-status">{error||'위젯 준비 중…'}</div>;
 const settings={...data.card.settings,tilt:options.followMouse};
 return <main className="widget-shell" data-ready={ready} data-auto={options.autoRotate} data-follow={options.followMouse} data-size={options.size}>
  <Viewer ref={viewer} card={data.card} settings={settings} mode="relief" hidden={new Set(settings.hidden_layers)} autoRotate={options.autoRotate} zoom={data.zoom} theme={data.theme} interactive={false} onReady={()=>setReady(true)}/>
  <div className="widget-drag" aria-label="드래그해서 위젯 이동" title="드래그해서 이동"/>
  <div className={`widget-toolbar ${open?'shown':''}`}><span className="widget-grip" title="드래그해서 이동"><GripHorizontal size={17}/></span><button aria-label="위젯 설정" title="위젯 설정" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><Settings size={17}/></button><button aria-label="위젯 닫기" title="위젯 닫기" onClick={()=>window.widget.close()}><X size={17}/></button></div>
  {open&&<section className="widget-settings" aria-label="위젯 설정"><header><strong>위젯 설정</strong><button aria-label="설정 닫기" onClick={()=>setOpen(false)}><X size={15}/></button></header><label htmlFor="widget-auto">자동 회전<input id="widget-auto" type="checkbox" checked={options.autoRotate} onChange={e=>update({autoRotate:e.target.checked})}/></label><label htmlFor="widget-follow">마우스 따라 회전<input id="widget-follow" type="checkbox" checked={options.followMouse} onChange={e=>update({followMouse:e.target.checked})}/></label><label htmlFor="widget-size">크기<select id="widget-size" value={options.size} onChange={e=>update({size:e.target.value})}><option value="small">작게</option><option value="medium">보통</option><option value="large">크게</option></select></label>{error&&<p role="alert">{error}</p>}</section>}
  {!ready&&<div className="widget-status">불러오는 중…</div>}
 </main>;
}
createRoot(document.getElementById('root')).render(<Widget/>);
