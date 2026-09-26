import { NextResponse } from 'next/server';
import { register } from '@/lib/auth';
import { rateLimit, clientKey } from '@/lib/rate-limit';
export async function POST(req:Request){const rl=rateLimit(`register:${clientKey(req)}`,5,60*60_000);if(!rl.ok)return NextResponse.json({error:'Too many registration attempts. Try again later.'},{status:429,headers:{'Retry-After':String(rl.retryAfter)}});try{const b=await req.json();await register(String(b.email||''),String(b.password||''),String(b.displayName||''));return NextResponse.json({ok:true})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Registration failed'},{status:400})}}
