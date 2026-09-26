import { NextResponse } from 'next/server';
import { login } from '@/lib/auth';
import { rateLimit, clientKey } from '@/lib/rate-limit';
export async function POST(req:Request){const rl=rateLimit(`login:${clientKey(req)}`,8,15*60_000);if(!rl.ok)return NextResponse.json({error:'Too many attempts. Try again later.'},{status:429,headers:{'Retry-After':String(rl.retryAfter)}});try{const b=await req.json();await login(String(b.email||''),String(b.password||''));return NextResponse.json({ok:true})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Login failed'},{status:400})}}
