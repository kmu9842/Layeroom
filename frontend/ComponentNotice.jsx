export default function ComponentNotice({capabilities,onInstall}) {
 if(capabilities?.ai!==false)return null;
 return <div className="component-notice">
  <span>PSD는 바로 가져올 수 있습니다. PNG·JPG·WebP의 자동 분절은 추가 설치가 필요합니다.</span>
  {capabilities.setup&&<button onClick={onInstall}>자동 분절 설치</button>}
 </div>;
}
