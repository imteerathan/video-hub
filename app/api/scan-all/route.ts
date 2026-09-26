import { NextResponse } from 'next/server';
import { scanDueSources } from '@/lib/scanner';
import { timingSafeEqual } from 'node:crypto';
function authorized(req:Request,secret:string){const supplied=req.headers.get('authorization')||'';const a=Buffer.from(supplied);const b=Buffer.from(`Bearer ${secret}`);return a.length===b.length&&timingSafeEqual(a,b)}
export async function POST(req:Request){const secret=process.env.SCAN_CRON_SECRET;if(!secret)return NextResponse.json({error:'Cron secret is not configured'},{status:503});if(!authorized(req,secret))return NextResponse.json({error:'Unauthorized'},{status:401});try{return NextResponse.json(await scanDueSources())}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Scan failed'},{status:500})}}
