import {useEffect,useRef,useState} from 'react';
import {ImagePlus,Loader2} from 'lucide-react';
import {appearance,backgroundCSS,frameThemes} from './frameThemes';

export default function ThemePicker({card,settings,update}){
 const fileInput=useRef(null),mounted=useRef(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>()=>{mounted.current=false;},[]);
 const theme=appearance(settings,document.documentElement.dataset.theme),custom=settings.frame_theme==='custom';
 const imageURL=theme.image?`/assets/${card.id}/${theme.image}`:'';
 async function upload(file){
  if(!file)return;setError('');if(file.size>10*1024*1024){setError('배경 이미지는 10MB 이하로 선택해 주세요.');return;}setBusy(true);
  try{const form=new FormData();form.append('file',file);const response=await fetch(`/api/cards/${card.id}/background`,{method:'POST',body:form}),result=await response.json();if(!response.ok)throw Error(result.detail||'배경을 읽을 수 없습니다.');if(mounted.current)update({custom_background_image:result.file,custom_background_style:'image'});}catch(e){if(mounted.current)setError(e.message);}finally{if(mounted.current)setBusy(false);}
 }
 function choose(id){const patch={frame_theme:id};if(id==='custom'&&!settings.custom_frame_color)Object.assign(patch,{custom_frame_color:theme.frame,custom_background_color:theme.colors[0],custom_background_secondary:theme.colors[1],custom_background_style:theme.pattern});update(patch);}
 return <><div className="theme-picker"><div><label htmlFor="frame-theme">액자 테마</label><select id="frame-theme" value={settings.frame_theme||settings.frame||'champagne'} onChange={e=>choose(e.target.value)}>{frameThemes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}<option value="custom">커스텀</option></select></div><div className="theme-preview" role="img" aria-label="액자 테마 미리보기" style={{borderColor:theme.frame,background:backgroundCSS(theme,imageURL)}}><img src={`/assets/${card.id}/cutout.png?v=${card.updated_at}`} alt=""/></div></div>
 {custom&&<div className="custom-theme"><label htmlFor="custom-frame">액자 색상<input id="custom-frame" type="color" value={settings.custom_frame_color||theme.frame} onChange={e=>update({custom_frame_color:e.target.value})}/></label><label htmlFor="custom-background-style">배경<select id="custom-background-style" value={theme.pattern} onChange={e=>update({custom_background_style:e.target.value})}><option value="solid">단색</option><option value="gradient">그라데이션</option><option value="linen">패브릭</option><option value="grid">격자</option><option value="image">이미지</option></select></label>
 {theme.pattern==='image'?<><button className="background-upload" disabled={busy} onClick={()=>fileInput.current.click()}>{busy?<Loader2 size={14} className="spin"/>:<ImagePlus size={14}/>}배경 이미지 선택</button><input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{upload(e.target.files?.[0]);e.target.value='';}}/></>:<><label htmlFor="custom-background">배경 색상<input id="custom-background" type="color" value={theme.colors[0]} onChange={e=>update({custom_background_color:e.target.value})}/></label>{theme.pattern!=='solid'&&<label htmlFor="custom-secondary">보조 색상<input id="custom-secondary" type="color" value={theme.colors[1]} onChange={e=>update({custom_background_secondary:e.target.value})}/></label>}</>}{error&&<p className="error-text" role="alert">{error}</p>}</div>}</>;
}
