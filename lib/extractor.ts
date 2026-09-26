import { safeFetchText, assertSafeUrl } from '@/lib/security';
export type ExtractedVideo = { title:string; url:string; type:'mp4'|'hls'|'dash'|'unknown'; thumbnailUrl?:string; duration?:number; resolution?:string; publishedAt?:string };
function absolute(base:string,value:string){try{return new URL(value,base).toString()}catch{return null}}
function dateFromHtml(html:string){const patterns=[/<meta[^>]+(?:property|name)=["'](?:article:published_time|datePublished|pubdate)["'][^>]+content=["']([^"']+)["']/i,/<time[^>]+datetime=["']([^"']+)["']/i];for(const r of patterns){const m=r.exec(html);if(m&&Number.isFinite(Date.parse(m[1])))return new Date(m[1]).toISOString()}return undefined}
export async function extractPublicVideoSources(pageUrl:string):Promise<ExtractedVideo[]>{
 await assertSafeUrl(pageUrl);
 const res=await safeFetchText(pageUrl);
 if(!res.response.ok)throw new Error(`Source returned HTTP ${res.response.status}`);
 const html=res.text;if(html.length>8_000_000)throw new Error('Source page is too large');
 const pagePublishedAt=dateFromHtml(html),out:ExtractedVideo[]=[];
 const push=(url:string,title:string,thumb?:string)=>{const x=absolute(res.url,url);if(!x)return;const lower=x.toLowerCase();const type=lower.includes('.m3u8')?'hls':lower.includes('.mpd')?'dash':lower.includes('.mp4')?'mp4':'unknown';if(!out.some(v=>v.url===x))out.push({title:title||'Video',url:x,type,thumbnailUrl:thumb,publishedAt:pagePublishedAt})};
 const videoRe=/<video\b[^>]*?(?:src=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/video>/gi;let m:RegExpExecArray|null;while((m=videoRe.exec(html))){const tag=m[0],src=m[1],poster=/poster=["']([^"']+)["']/i.exec(tag)?.[1];if(src)push(src,'Video',poster);for(const sm of m[2].matchAll(/<source\b[^>]*src=["']([^"']+)["'][^>]*>/gi))push(sm[1],'Video',poster)}
 for(const sm of html.matchAll(/(?:https?:)?\/\/[^\s"'<>]+\.(?:m3u8|mpd|mp4)(?:\?[^\s"'<>]*)?/gi))push(sm[0],'Video');return out;
}
