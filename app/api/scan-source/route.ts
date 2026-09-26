import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { scanSource } from '@/lib/scanner';
import { rateLimit, clientKey } from '@/lib/rate-limit';
export async function POST(req:Request){try{const user=await requireUser();const rl=rateLimit(`scan-source:${clientKey(req,user.id)}`,12,60*60_000);if(!rl.ok)return NextResponse.json({error:'Scan rate limit exceeded'},{status:429,headers:{'Retry-After':String(rl.retryAfter)}});const {sourceId}=await req.json();if(!sourceId)return NextResponse.json({error:'sourceId required'},{status:400});return NextResponse.json(await scanSource(String(sourceId),user.id))}catch(e){const m=e instanceof Error?e.message:'Scan failed';return NextResponse.json({error:m},{status:m==='UNAUTHENTICATED'?401:400})}}
