import {notFound,redirect} from 'next/navigation';
import {db} from '@/lib/db';
import {getCurrentUser} from '@/lib/auth';
export default async function WatchSource({params}:{params:Promise<{id:string}>}){
 const user=await getCurrentUser(); if(!user) redirect('/login');
 const {id}=await params;
 const src=await db.videoSource.findFirst({where:{id,source:{userId:user.id}},include:{source:true,content:true,episode:{include:{season:{include:{content:true}}}}}});
 if(!src) return notFound();
 const title=src.episode?`${src.episode.season.content.title} · S${src.episode.season.number} E${src.episode.number} · ${src.episode.title}`:(src.title||src.content?.title||'Video');
 return <main className="container"><p className="muted">{src.source.name}</p><h1>{title}</h1><video controls playsInline preload="metadata" style={{width:'100%',maxHeight:'75vh',background:'#000',borderRadius:14}} src={src.url}/></main>
}
