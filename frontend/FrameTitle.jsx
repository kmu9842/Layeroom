import {useEffect,useRef,useState} from 'react';
import {Pencil} from 'lucide-react';

export default function FrameTitle({title,onRename}){
 const [editing,setEditing]=useState(false),[value,setValue]=useState(title),[busy,setBusy]=useState(false),cancelled=useRef(false),pending=useRef(false);
 useEffect(()=>{setValue(title);setEditing(false);},[title]);
 async function commit(){
  if(cancelled.current||pending.current)return;
  const name=value.trim();
  if(!name||name===title){setValue(title);setEditing(false);return;}
  pending.current=true;setBusy(true);
  try{if(await onRename(name))setEditing(false);}finally{pending.current=false;setBusy(false);}
 }
 return <div className="stage-title inline-frame-title">{editing?<input autoFocus aria-label="액자 이름" value={value} maxLength={80} disabled={busy} onFocus={e=>e.target.select()} onChange={e=>setValue(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commit();}if(e.key==='Escape'){cancelled.current=true;setValue(title);setEditing(false);}}}/>:<button aria-label="액자 이름 수정" title="클릭해서 이름 수정" onClick={()=>{cancelled.current=false;setValue(title);setEditing(true);}}><span>{title}</span><Pencil size={13}/></button>}</div>;
}
