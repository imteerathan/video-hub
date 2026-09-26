import { NextResponse } from 'next/server';
import { extractPublicVideoSources } from '@/lib/extractor';
import { requireUser } from '@/lib/auth';
import { rateLimit, clientKey } from '@/lib/rate-limit';
export async function POST(req:Request){try{const user=await requireUser();const rl=rateLimit(`scan:${clientKey(req,user.id)}`,10,60*60_000);if(!rl.ok)return NextResponse.json({error:'Scan rate limit exceeded'},{status:429,headers:{'Retry-After':String(rl.retryAfter)}});const body=await req.formData();const url=String(body.get('url')||'');if(url.length>2048)return NextResponse.json({error:'URL is too long'},{status:400});const videos=await extractPublicVideoSources(url);return NextResponse.json({url,count:videos.length,videos});}catch(e){const message=e instanceof Error?e.message:'Scan failed';return NextResponse.json({error:message},{status:message==='UNAUTHENTICATED'?401:400})}}
