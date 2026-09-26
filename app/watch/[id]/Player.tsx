'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';

type Track={id:string;kind:string;languageCode:string|null;languageLabel:string;url?:string|null;isDefault:boolean;isForced:boolean};
type Src={id:string;url:string;type:string;title?:string|null;resolution?:string|null;tracks?:Track[]};
const pref=['th','en','zh-CN','zh-TW','ja','ko','es'];
function pick(a:Track[],k:string){return a.filter(x=>x.kind===k).sort((x,y)=>(pref.indexOf(x.languageCode||'')<0?99:pref.indexOf(x.languageCode||''))-(pref.indexOf(y.languageCode||'')<0?99:pref.indexOf(y.languageCode||''))||Number(y.isDefault)-Number(x.isDefault))[0]}
function isHls(s?:Src){return !!s?.url&&(/\.m3u8($|\?)/i.test(s.url)||/HLS/i.test(s.type))}

export default function Player({episodeId,title,sources,nextEpisodeId,previousEpisodeId}:{episodeId:string;title:string;sources:Src[];nextEpisodeId?:string|null;previousEpisodeId?:string|null}){
 const video=useRef<HTMLVideoElement>(null); const hlsRef=useRef<Hls|null>(null);
 const [srcId,setSrcId]=useState(sources[0]?.id||''); const src=sources.find(s=>s.id===srcId)||sources[0];
 const [tracks,setTracks]=useState<Track[]>(src?.tracks||[]); const [speed,setSpeed]=useState(1); const [error,setError]=useState(''); const [resume,setResume]=useState(0); const [qualities,setQualities]=useState<number[]>([]); const [quality,setQuality]=useState(-1); const [autoplayNext,setAutoplayNext]=useState(true);
 const audio=useMemo(()=>pick(tracks,'AUDIO'),[tracks]); const sub=useMemo(()=>pick(tracks,'SUBTITLE'),[tracks]);
 useEffect(()=>{let cancelled=false; if(!src)return; setTracks(src.tracks||[]); setError(''); setQualities([]); setQuality(-1); fetch(`/api/video-source/${src.id}/resolve`,{method:'POST'}).then(r=>r.ok?r.json():null).then(d=>{if(!cancelled&&d?.tracks)setTracks(d.tracks)}).catch(()=>{}); return()=>{cancelled=true}},[src?.id]);
 useEffect(()=>{const v=video.current;if(!v||!src)return; hlsRef.current?.destroy(); hlsRef.current=null; setError('');
   const onReady=()=>{ if(resume>0 && Math.abs(v.currentTime-resume)>2){try{v.currentTime=resume}catch{}} v.playbackRate=speed };
   const onError=()=>{setError('Source playback failed. Trying another source…'); const idx=sources.findIndex(x=>x.id===src.id); const next=sources.slice(idx+1).find(Boolean); if(next)setTimeout(()=>setSrcId(next.id),250); else setError('Source playback failed. Try another source.')};
   v.addEventListener('loadedmetadata',onReady); v.addEventListener('error',onError);
   if(isHls(src) && !v.canPlayType('application/vnd.apple.mpegurl')){ if(Hls.isSupported()){const h=new Hls({enableWorker:true,maxBufferLength:30}); hlsRef.current=h; h.loadSource(src.url); h.attachMedia(v); h.on(Hls.Events.MANIFEST_PARSED,(_,data)=>{setQualities(data.levels.map((x:any)=>x.height).filter(Boolean).filter((x:number,i:number,a:number[])=>a.indexOf(x)===i).sort((a,b)=>b-a));}); h.on(Hls.Events.ERROR,(_,data)=>{if(data.fatal)onError()});} else setError('This browser cannot play this HLS source.'); }
   else v.src=src.url;
   return()=>{v.removeEventListener('loadedmetadata',onReady);v.removeEventListener('error',onError);hlsRef.current?.destroy();hlsRef.current=null;v.removeAttribute('src');v.load()}
 },[src?.id]);
 useEffect(()=>{if(video.current)video.current.playbackRate=speed},[speed]);
 useEffect(()=>{fetch(`/api/watch-history?episodeId=${encodeURIComponent(episodeId)}`).then(r=>r.ok?r.json():null).then(d=>{if(d?.positionSec)setResume(d.positionSec)}).catch(()=>{})},[episodeId]);
 useEffect(()=>{const v=video.current;if(!v)return;const save=()=>fetch('/api/watch-history',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({episodeId,sourceId:src?.id,positionSec:Math.floor(v.currentTime),completed:v.ended})}).catch(()=>{});const ended=()=>{save();if(autoplayNext&&nextEpisodeId)window.location.href=`/watch/${nextEpisodeId}`};v.addEventListener('pause',save);v.addEventListener('ended',ended);return()=>{v.removeEventListener('pause',save);v.removeEventListener('ended',ended)}},[episodeId,src?.id,autoplayNext,nextEpisodeId]);
 const setQualityLevel=(height:number)=>{setQuality(height);const h=hlsRef.current;if(!h)return; if(height<0){h.currentLevel=-1;return} const i=h.levels.findIndex((x:any)=>x.height===height);if(i>=0)h.currentLevel=i};
 return <section className="player-shell"><div className="player-head"><div><small>NOW PLAYING</small><h1>{title}</h1></div><span>{src?.resolution||src?.type?.toUpperCase()}</span></div>
  {src?<video ref={video} controls playsInline preload="metadata" style={{width:'100%',maxHeight:'72vh',background:'#000',borderRadius:16}}>{tracks.filter(t=>t.kind==='SUBTITLE'&&t.url).map(t=><track key={t.id} kind="subtitles" src={t.url!} srcLang={t.languageCode||''} label={t.languageLabel} default={t.id===sub?.id}/>)}</video>:null}
  {error&&<div className="card" style={{marginTop:12}}>{error}</div>}
  <div className="player-controls">
   <label>Source <select value={srcId} onChange={e=>setSrcId(e.target.value)}>{sources.map((s,i)=><option key={s.id} value={s.id}>{s.title||`Source ${i+1}`} · {s.resolution||s.type.toUpperCase()}</option>)}</select></label>
   <label>Speed <select value={speed} onChange={e=>setSpeed(+e.target.value)}>{[.75,1,1.25,1.5,2].map(x=><option key={x} value={x}>{x}×</option>)}</select></label>
   {qualities.length>0&&<label>Quality <select value={quality} onChange={e=>setQualityLevel(+e.target.value)}><option value={-1}>Auto</option>{qualities.map(q=><option key={q} value={q}>{q}p</option>)}</select></label>}
   <div className="track-summary"><span>🔊 {audio?.languageLabel||'Default audio'}</span><span>💬 {sub?.languageLabel||'Subtitles off'}</span></div>
   <label className="inline-check"><input type="checkbox" checked={autoplayNext} onChange={e=>setAutoplayNext(e.target.checked)}/> Auto next</label>
  </div>
  <div className="player-nav"><button disabled={!previousEpisodeId} onClick={()=>previousEpisodeId&&(window.location.href=`/watch/${previousEpisodeId}`)}>← Previous</button><button disabled={!nextEpisodeId} onClick={()=>nextEpisodeId&&(window.location.href=`/watch/${nextEpisodeId}`)}>Next →</button></div>
 </section>
}
