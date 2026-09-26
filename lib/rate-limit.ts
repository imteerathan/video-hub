type Bucket={count:number;resetAt:number};
const buckets=new Map<string,Bucket>();
const MAX_KEYS=5000;
export function rateLimit(key:string,limit:number,windowMs:number){
  const now=Date.now();
  if(buckets.size>MAX_KEYS){for(const [k,v] of buckets){if(v.resetAt<=now)buckets.delete(k);if(buckets.size<=MAX_KEYS)break}}
  const b=buckets.get(key);
  if(!b||b.resetAt<=now){buckets.set(key,{count:1,resetAt:now+windowMs});return {ok:true,retryAfter:0}}
  b.count++;
  return {ok:b.count<=limit,retryAfter:Math.max(1,Math.ceil((b.resetAt-now)/1000))};
}
export function clientKey(req:Request,userId?:string){return `${userId||'anon'}:${req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||req.headers.get('x-real-ip')||'unknown'}`}
