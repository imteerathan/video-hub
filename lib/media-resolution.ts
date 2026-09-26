import { safeFetchText, assertSafeUrl } from '@/lib/security';
export type MediaTrackCandidate={kind:'AUDIO'|'SUBTITLE';language:string;label:string;url?:string;mimeType?:string;isDefault?:boolean;isForced?:boolean};
function abs(base:string,value:string){try{return new URL(value,base).toString()}catch{return undefined}}
const names:Record<string,string>={th:'ไทย',en:'English',zh:'中文','zh-CN':'中文 (简体)','zh-TW':'中文 (繁體)',ja:'日本語',ko:'한국어',es:'Español'};
function lang(raw?:string){if(!raw)return;const x=raw.trim().toLowerCase().replace('_','-');if(x.startsWith('th'))return'th';if(x.startsWith('en'))return'en';if(x.startsWith('zh'))return x.includes('tw')||x.includes('hant')?'zh-TW':'zh-CN';if(x.startsWith('ja'))return'ja';if(x.startsWith('ko'))return'ko';if(x.startsWith('es'))return'es';return raw.trim()}
export function inferLanguage(raw?:string){const l=lang(raw);return l?{language:l,label:names[l]??l}:undefined}
export async function resolveMediaTracks(pageUrl:string,mediaUrl:string){
 await assertSafeUrl(pageUrl); await assertSafeUrl(mediaUrl);
 const out:MediaTrackCandidate[]=[];
 if(mediaUrl.toLowerCase().includes('.m3u8')){const r=await safeFetchText(mediaUrl);if(r.response.ok){const t=r.text;for(const line of t.split(/\r?\n/)){if(!line.startsWith('#EXT-X-MEDIA:'))continue;const type=/TYPE=([^,]+)/i.exec(line)?.[1]?.toUpperCase();if(type!=='AUDIO'&&type!=='SUBTITLES')continue;const li=inferLanguage(/LANGUAGE="([^"]+)"/i.exec(line)?.[1]||/NAME="([^"]+)"/i.exec(line)?.[1]);if(!li)continue;const uri=/URI="([^"]+)"/i.exec(line)?.[1];const url=uri?abs(r.url,uri):undefined;if(url)await assertSafeUrl(url);out.push({kind:type==='AUDIO'?'AUDIO':'SUBTITLE',language:li.language,label:li.label,url,mimeType:type==='AUDIO'?'audio/mp4':'text/vtt',isDefault:/DEFAULT=YES/i.test(line),isForced:/FORCED=YES/i.test(line)})}}}
 const p=await safeFetchText(pageUrl);if(p.response.ok){const html=p.text;for(const m of html.matchAll(/<track\b([^>]*?)>/gi)){const a=m[1];const kind=/kind=["']([^"']+)["']/i.exec(a)?.[1]?.toLowerCase();if(kind!=='subtitles'&&kind!=='captions')continue;const li=inferLanguage(/srclang=["']([^"']+)["']/i.exec(a)?.[1]||/label=["']([^"']+)["']/i.exec(a)?.[1]);const src=/src=["']([^"']+)["']/i.exec(a)?.[1];const url=src?abs(p.url,src):undefined;if(li&&url){await assertSafeUrl(url);out.push({kind:'SUBTITLE',language:li.language,label:li.label,url,mimeType:'text/vtt',isDefault:/\bdefault\b/i.test(a)})}}}
 return out.filter((x,i,a)=>a.findIndex(y=>y.kind===x.kind&&y.language===x.language&&y.url===x.url)===i)
}
