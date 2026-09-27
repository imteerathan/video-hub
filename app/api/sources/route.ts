import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { assertSafeUrl } from '@/lib/security';
const WINDOWS=[7,15,30];

async function validCategories(userId:string, ids:unknown){
  const cats=Array.isArray(ids)?ids.map(String).filter(Boolean).slice(0,50):[];
  return db.category.findMany({where:{userId,id:{in:cats}},select:{id:true}});
}

export async function GET(){
  try{
    const user=await requireUser();
    return NextResponse.json(await db.source.findMany({
      where:{userId:user.id},
      include:{categories:{include:{category:true}}},
      orderBy:{createdAt:'desc'}
    }));
  }catch{
    return NextResponse.json({error:'Unauthorized'},{status:401});
  }
}

export async function POST(req:Request){
  try{
    const user=await requireUser();
    const b=await req.json();
    const name=String(b.name||'').trim(),url=String(b.url||'').trim();
    if(!name||name.length>120)return NextResponse.json({error:'Source name is required and must be 120 characters or fewer'},{status:400});
    await assertSafeUrl(url);
    const scanWindow=WINDOWS.includes(Number(b.scanWindow))?Number(b.scanWindow):30;
    const scanIntervalHours=Math.min(168,Math.max(1,Number(b.scanIntervalHours)||24));
    const valid=await validCategories(user.id,b.categoryIds);
    const source=await db.source.create({
      data:{
        userId:user.id,name,url,scanWindow,scanIntervalHours,
        enabled:b.enabled!==false,
        categories:{create:valid.map(c=>({categoryId:c.id}))}
      }
    });
    return NextResponse.json(source,{status:201});
  }catch(e){
    return NextResponse.json({error:e instanceof Error?e.message:'Failed'},{status:400});
  }
}

export async function PUT(req:Request){
  try{
    const user=await requireUser();
    const b=await req.json();
    const id=String(b.id||'').trim();
    if(!id)return NextResponse.json({error:'id required'},{status:400});
    const existing=await db.source.findFirst({where:{id,userId:user.id}});
    if(!existing)return NextResponse.json({error:'Source not found'},{status:404});
    const name=String(b.name??existing.name).trim();
    const url=String(b.url??existing.url).trim();
    if(!name||name.length>120)return NextResponse.json({error:'Source name is required and must be 120 characters or fewer'},{status:400});
    await assertSafeUrl(url);
    const scanWindow=WINDOWS.includes(Number(b.scanWindow))?Number(b.scanWindow):existing.scanWindow;
    const scanIntervalHours=Math.min(168,Math.max(1,Number(b.scanIntervalHours)||existing.scanIntervalHours||24));
    const valid=await validCategories(user.id,b.categoryIds);
    const enabled=typeof b.enabled==='boolean'?b.enabled:existing.enabled;
    const source=await db.$transaction(async tx=>{
      await tx.sourceCategory.deleteMany({where:{sourceId:id}});
      return tx.source.update({
        where:{id},
        data:{
          name,url,scanWindow,scanIntervalHours,enabled,
          categories:{create:valid.map(c=>({categoryId:c.id}))}
        },
        include:{categories:{include:{category:true}}}
      });
    });
    return NextResponse.json(source);
  }catch(e){
    return NextResponse.json({error:e instanceof Error?e.message:'Failed'},{status:400});
  }
}

export async function DELETE(req:Request){
  try{
    const user=await requireUser();
    const id=new URL(req.url).searchParams.get('id');
    if(!id)return NextResponse.json({error:'id required'},{status:400});
    await db.source.deleteMany({where:{id,userId:user.id}});
    return NextResponse.json({ok:true});
  }catch{
    return NextResponse.json({error:'Unauthorized'},{status:401});
  }
}
