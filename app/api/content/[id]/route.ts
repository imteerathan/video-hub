import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';

export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const user=await requireUser(); const {id}=await params; const body=await req.json();
    const existing=await db.content.findFirst({where:{id,userId:user.id}}); if(!existing)return NextResponse.json({error:'Not found'},{status:404});
    const allowedTypes=['SERIES','MOVIE','CLIP','VIDEO'];
    const contentType=allowedTypes.includes(String(body.contentType))?String(body.contentType):existing.contentType;
    const data={
      originalTitle:String(body.originalTitle??existing.originalTitle??existing.title).trim()||null,
      englishTitle:String(body.englishTitle??existing.englishTitle??existing.title).trim()||null,
      thaiTitle:String(body.thaiTitle??existing.thaiTitle??'').trim()||null,
      displayTitle:String(body.displayTitle??existing.displayTitle??body.englishTitle??existing.englishTitle??existing.title).trim()||existing.title,
      description:String(body.description??existing.description??'').trim()||null,
      posterUrl:String(body.posterUrl??existing.posterUrl??'').trim()||null,
      backdropUrl:String(body.backdropUrl??existing.backdropUrl??'').trim()||null,
      contentType,
      year:body.year===''||body.year==null?existing.year:Number.isFinite(Number(body.year))?Number(body.year):existing.year
    };
    const updated=await db.content.update({where:{id},data});
    return NextResponse.json(updated);
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Failed'},{status:400})}
}
