export const frameThemes=[
 {id:'champagne',name:'샴페인',frame:'#b5a489',colors:['#d7d4cc','#f0eee5'],pattern:'gradient',metalness:.75},
 {id:'silver',name:'실버',frame:'#a1a9b1',colors:['#c4cdd6','#eff3f7'],pattern:'gradient',metalness:.85},
 {id:'carbon',name:'카본',frame:'#383d43',colors:['#1e242b','#434f5c'],pattern:'gradient',metalness:.4},
 {id:'walnut',name:'월넛',frame:'#6b4937',colors:['#cfbfaa','#eee4d3'],pattern:'linen',metalness:0},
 {id:'oak',name:'오크',frame:'#b89162',colors:['#eee1c8','#fff6e2'],pattern:'linen',metalness:0},
 {id:'ivory',name:'아이보리',frame:'#e1dcd0',colors:['#e9e3d8','#faf7ef'],pattern:'solid',metalness:.05},
 {id:'navy',name:'네이비',frame:'#293b56',colors:['#18273c','#4b6480'],pattern:'gradient',metalness:.25},
 {id:'rose',name:'로즈',frame:'#bc8794',colors:['#e4bfc9','#fff0ef'],pattern:'gradient',metalness:.45},
 {id:'gold',name:'골드',frame:'#b68d41',colors:['#293831','#53604c'],pattern:'linen',metalness:.85},
 {id:'lavender',name:'라벤더',frame:'#9b8eaf',colors:['#d0c4df','#f5edfc'],pattern:'gradient',metalness:.2},
];
const legacyBackgrounds={light:['#d7d4cc','#f0eee5'],dark:['#202c33','#465763'],midnight:['#202c33','#465763'],sage:['#475b51','#879684'],rose:['#604955','#a17f89']};
export function appearance(settings,systemTheme='light'){
 if(settings.frame_theme==='custom')return {frame:settings.custom_frame_color||'#b5a489',colors:[settings.custom_background_color||'#d7d4cc',settings.custom_background_secondary||'#f0eee5'],pattern:settings.custom_background_style||'gradient',image:settings.custom_background_image||'',metalness:.2};
 const preset=frameThemes.find(t=>t.id===(settings.frame_theme||settings.frame))||frameThemes[0];
 // Preserve existing saved backgrounds until a new theme is explicitly chosen.
 return settings.frame_theme?{...preset}:{...preset,pattern:'gradient',colors:legacyBackgrounds[settings.background==='system'?systemTheme:settings.background]||legacyBackgrounds[systemTheme]};
}
export function backgroundCSS(style,imageURL){
 const [base,light]=style.colors;
 if(style.pattern==='image'&&imageURL)return `url("${imageURL}") center / cover`;
 if(style.pattern==='solid')return base;
 if(style.pattern==='grid')return `linear-gradient(${light}80 1px,transparent 1px) 0 0 / 12px 12px,linear-gradient(90deg,${light}80 1px,transparent 1px) 0 0 / 12px 12px,${base}`;
 if(style.pattern==='linen')return `repeating-linear-gradient(0deg,${light}44 0 1px,transparent 1px 3px),repeating-linear-gradient(90deg,${light}44 0 1px,transparent 1px 3px),${base}`;
 return `radial-gradient(ellipse at 50% 44%,${light},${base})`;
}
