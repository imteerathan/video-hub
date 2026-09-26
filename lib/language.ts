export type TrackKind = 'AUDIO' | 'SUBTITLE';
export type MediaTrack = { id:string; kind:TrackKind; languageCode?:string|null; languageLabel:string; url:string; mimeType?:string|null; format?:string|null; isDefault?:boolean; isForced?:boolean };

const aliases:Record<string,string> = {
  'ไทย':'th','thai':'th','th':'th', 'พากย์ไทย':'th', 'ซับไทย':'th',
  'อังกฤษ':'en','english':'en','eng':'en','en':'en', 'ซับอังกฤษ':'en',
  'จีน':'zh','chinese':'zh','chi':'zh','zh':'zh','中文':'zh', 'พากย์จีน':'zh',
  'ญี่ปุ่น':'ja','japanese':'ja','jpn':'ja','ja':'ja',
  'เกาหลี':'ko','korean':'ko','kor':'ko','ko':'ko'
};
export function normalizeLanguage(value:string){
  const v=value.trim().toLowerCase();
  return aliases[v] ?? v;
}
export function displayLanguage(code:string|undefined|null,label?:string){
  if(label) return label;
  const c=(code||'').toLowerCase();
  return ({th:'ไทย',en:'English',zh:'中文',ja:'日本語',ko:'한국어'} as Record<string,string>)[c] || (code || 'Unknown');
}
