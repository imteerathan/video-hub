import {notFound,redirect} from 'next/navigation';
import Link from 'next/link';
import {db} from '@/lib/db';
import {getCurrentUser} from '@/lib/auth';
import EditContent from './EditContent';
export default async function ContentDetail({params}:{params:Promise<{id:string}>}){
 const user=await getCurrentUser();if(!user)redirect('/login');const {id}=await params;
 const c=await db.content.findFirst({where:{id,userId:user.id},include:{categories:{include:{category:true}},sources:{include:{tracks:true}},seasons:{include:{episodes:{include:{sources:{include:{tracks:true}}}}}}}});if(!c)return notFound();
 const title=c.displayTitle||c.englishTitle||c.originalTitle||c.title;const poster=c.posterUrl||c.seasons.flatMap(s=>s.episodes).find(e=>e.thumbnailUrl)?.thumbnailUrl||c.sources.find(s=>s.thumbnailUrl)?.thumbnailUrl;
 const allSources=c.sources.concat(c.seasons.flatMap(s=>s.episodes.flatMap(e=>e.sources)));
 const audio=Array.from(new Set(allSources.flatMap(s=>s.tracks.filter(t=>t.kind==='AUDIO').map(t=>t.languageLabel))));const subs=Array.from(new Set(allSources.flatMap(s=>s.tracks.filter(t=>t.kind==='SUBTITLE').map(t=>t.languageLabel))));
 return <main className="container content-detail"><section className="detail-hero"><div className="detail-poster">{poster?<img className="poster-img" src={poster} alt=""/>:<div className="poster-fallback">{title.slice(0,2).toUpperCase()}</div>}</div><div className="detail-copy"><div className="eyebrow">{c.contentType}</div><h1>{title}</h1>{c.thaiTitle&&c.thaiTitle!==title&&<div className="detail-thai">{c.thaiTitle}</div>}<p className="muted">{c.year?`${c.year} · `:''}{c.categories.map(x=>x.category.name).join(' · ')}</p>{c.description&&<p className="detail-description">{c.description}</p>}<div className="language-summary">{audio.length>0&&<span>🔊 {audio.join(' · ')}</span>}{subs.length>0&&<span>💬 {subs.join(' · ')}</span>}</div><div className="row"><EditContent content={c}/></div></div></section>
 {c.seasons.map(s=><section className="detail-season" key={s.id}><div className="section-head"><h2>{s.title||`Season ${s.number}`}</h2><span className="muted">{s.episodes.length} episodes</span></div><div className="episode-grid">{s.episodes.sort((a,b)=>a.number-b.number).map(e=>{const epTitle=e.displayTitle||e.englishTitle||e.originalTitle||e.title;const epPoster=e.thumbnailUrl||e.sources.find(v=>v.thumbnailUrl)?.thumbnailUrl;return <Link className="episode-card" href={`/watch/${e.id}`} key={e.id}><div className="episode-thumb">{epPoster?<img className="poster-img" src={epPoster} alt=""/>:<div className="poster-fallback">E{e.number}</div>}</div><div className="episode-meta"><strong>E{String(e.number).padStart(2,'0')} · {epTitle}</strong><span>{e.sources.length} source{e.sources.length!==1?'s':''}</span></div></Link>})}</div></section>)}
 {c.seasons.length===0&&c.sources.length>0&&<section className="detail-sources"><h2>Available Sources</h2><div className="source-list">{c.sources.map(s=><Link className="source-row" href={`/watch/source/${s.id}`} key={s.id}><span>{s.siteName||'Source'}</span><span>{s.resolution||s.type.toUpperCase()}</span><span>▶ Play</span></Link>)}</div></section>}
 </main>
}
