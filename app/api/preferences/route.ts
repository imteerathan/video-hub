import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { z } from 'zod';
const schema=z.object({audio:z.array(z.string()).max(10),subtitle:z.array(z.string()).max(10),playbackSpeed:z.number().min(.5).max(2).optional()});
export async function GET(){try{const u=await requireUser();return NextResponse.json({audio:u.preferredAudioCodes.split(',').filter(Boolean),subtitle:u.preferredSubtitleCodes.split(',').filter(Boolean),playbackSpeed:u.playbackSpeed});}catch{return NextResponse.json({error:'Unauthorized'},{status:401});}}
export async function PUT(req:Request){try{const u=await requireUser();const b=schema.parse(await req.json());const updated=await db.user.update({where:{id:u.id},data:{preferredAudioCodes:b.audio.join(','),preferredSubtitleCodes:b.subtitle.join(','),playbackSpeed:b.playbackSpeed??u.playbackSpeed}});return NextResponse.json({ok:true,audio:updated.preferredAudioCodes.split(',').filter(Boolean),subtitle:updated.preferredSubtitleCodes.split(',').filter(Boolean),playbackSpeed:updated.playbackSpeed});}catch(e:any){return NextResponse.json({error:e?.message||'Invalid request'},{status:e?.message==='UNAUTHENTICATED'?401:400});}}
