import Link from 'next/link';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import ClipThumbnail from './ClipThumbnail';

function languageBadges(tracks: {kind:string; languageCode:string|null; languageLabel:string}[]) {
  const audio = Array.from(new Map(tracks.filter(t=>t.kind==='AUDIO').map(t=>[t.languageCode||t.languageLabel,t])).values());
  const subs = Array.from(new Map(tracks.filter(t=>t.kind==='SUBTITLE').map(t=>[t.languageCode||t.languageLabel,t])).values());
  const code=(t:{languageCode:string|null;languageLabel:string}) => (t.languageCode||t.languageLabel).toUpperCase();
  return {audio:audio.slice(0,3), audioMore:Math.max(0,audio.length-3), subs:subs.slice(0,3), subsMore:Math.max(0,subs.length-3), code};
}

function Poster({content}:{content:any}) {
  const poster=content.posterUrl || content.seasons?.flatMap((s:any)=>s.episodes).find((e:any)=>e.thumbnailUrl)?.thumbnailUrl || content.sources?.find((s:any)=>s.thumbnailUrl)?.thumbnailUrl;
  return poster ? <img className="poster-img" src={poster} alt="" loading="lazy" /> : <div className="poster-fallback">{(content.englishTitle||content.originalTitle||content.title||'VH').slice(0,2).toUpperCase()}</div>;
}

export default async function Library(){
 const user=await getCurrentUser(); if(!user)redirect('/login');
 const [items,history]=await Promise.all([
  db.content.findMany({where:{userId:user.id},include:{seasons:{include:{episodes:{include:{sources:{include:{tracks:true}}}}}},sources:{include:{tracks:true}},categories:{include:{category:true}}},orderBy:{updatedAt:'desc'}}),
  db.watchHistory.findMany({where:{userId:user.id,completed:false},include:{episode:{include:{season:{include:{content:true}}}}},orderBy:{updatedAt:'desc'},take:10})
 ]);
 const now=Date.now();
 const updated=items.filter(c=>now-c.updatedAt.getTime()<7*86400000);
 const seriesAndMovies=items.filter(c=>c.contentType==='SERIES'||c.contentType==='MOVIE');
 const clips=items.filter(c=>c.contentType==='CLIP'||c.contentType==='VIDEO');
 const title=(c:any)=>c.displayTitle||c.englishTitle||c.originalTitle||c.title;
 const thai=(c:any)=>c.thaiTitle && c.thaiTitle!==title(c) ? c.thaiTitle : null;
 return <main className="container netflix-home">
  <section className="catalog-hero"><div className="hero-copy"><div className="eyebrow">YOUR VIDEO HUB</div><h1>Watch what matters.</h1><p>One library, multiple sources, your preferred audio and subtitle languages.</p><div className="row"><Link className="btn" href="#library">Browse library</Link><Link className="btn secondary" href="/sources">Manage sources</Link></div></div></section>
  {history.length>0&&<section className="rail"><div className="section-head"><h2>Continue Watching</h2></div><div className="rail-grid">{history.map(h=><Link className="poster-card landscape" key={h.id} href={`/watch/${h.episodeId}`}><div className="poster-art"><span>{h.episode.season.content.title.slice(0,2).toUpperCase()}</span></div><div className="poster-meta"><strong>{h.episode.season.content.title}</strong><span>S{h.episode.season.number} E{h.episode.number} · {h.positionSec}s</span></div><div className="progress"><i style={{width:h.completed?'100%':'42%'}}/></div></Link>)}</div></section>}
  {updated.length>0&&<section className="rail"><div className="section-head"><h2>Recently Updated</h2><span className="muted">{updated.length} titles</span></div><div className="rail-grid">{updated.map(c=><Link className="poster-card" key={c.id} href={c.contentType==='SERIES'?`/library#${c.id}`:c.sources[0]?`/watch/source/${c.sources[0].id}`:`/library#${c.id}`}><div className="poster-art"><Poster content={c}/><span className="badge">UPDATE</span></div><div className="poster-meta"><strong>{title(c)}</strong>{thai(c)&&<span className="thai-title">{thai(c)}</span>}<span>{c.contentType==='SERIES'?`${c.seasons.reduce((n:number,s:any)=>n+s.episodes.length,0)} episodes`:c.sources[0]?.siteName||'Video'}</span></div></Link>)}</div></section>}
  <section id="library" className="rail"><div className="section-head"><h2>Movies & Series</h2><span className="muted">{seriesAndMovies.length}</span></div><div className="rail-grid">{seriesAndMovies.map(c=>{
    const tracks=c.sources.flatMap((s:any)=>s.tracks).concat(c.seasons.flatMap((s:any)=>s.episodes.flatMap((e:any)=>e.sources.flatMap((v:any)=>v.tracks))));
    const langs=languageBadges(tracks);
    return <article className="poster-card" id={c.id} key={c.id}>
      <Link href={`/content/${c.id}`}>
        <div className="poster-art"><Poster content={c}/>{c.updatedAt.getTime()>now-86400000&&<span className="badge">NEW</span>}</div>
        <div className="poster-meta"><strong className="title-original">{title(c)}</strong>{thai(c)&&<span className="thai-title">{thai(c)}</span>}<span>{c.contentType==='SERIES'?'Series':'Movie'}{c.year?` · ${c.year}`:''}</span>
          {(langs.audio.length||langs.subs.length)>0&&<div className="language-badges"><span>🔊 {langs.audio.map(l=>langs.code(l)).join(' ')||'—'}{langs.audioMore>0&&` +${langs.audioMore}`}</span><span>💬 {langs.subs.map(l=>langs.code(l)).join(' ')||'—'}{langs.subsMore>0&&` +${langs.subsMore}`}</span></div>}
        </div>
      </Link>
      {c.seasons.map((s:any)=><div className="episode-strip" key={s.id}><span>Season {s.number}</span>{s.episodes.sort((a:any,b:any)=>a.number-b.number).slice(0,8).map((e:any)=><Link key={e.id} href={`/watch/${e.id}`}>E{e.number}</Link>)}</div>)}
    </article>
  })}{!seriesAndMovies.length&&<div className="empty">No movies or series yet.</div>}</div></section>
  <section className="rail"><div className="section-head"><h2>Video Clips</h2><span className="muted">{clips.length}</span></div><div className="rail-grid">{clips.map(c=>{const v=c.sources[0];return <Link className="poster-card" key={c.id} href={v?`/watch/source/${v.id}`:`#${c.id}`}><ClipThumbnail src={v?.url} type={v?.type} thumbnail={v?.thumbnailUrl} /><div className="poster-meta"><strong>{title(c)}</strong><span>{v?.siteName||'Video'}</span></div></Link>})}{!clips.length&&<div className="empty">No clips yet.</div>}</div></section>
 </main>
}
