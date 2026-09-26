import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 8_000_000;
const USER_AGENT = 'VideoHubBot/1.0';

function isPrivateIPv4(ip: string) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(Number.isNaN)) return true;
  const [a,b] = p;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
function isPrivateIPv6(ip: string) {
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb');
}
function isBlockedHostname(host: string) {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa');
}

export async function assertSafeUrl(input: string) {
  let u: URL;
  try { u = new URL(input); } catch { throw new Error('Invalid URL'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only HTTP/HTTPS sources are supported');
  if (u.username || u.password) throw new Error('URLs with embedded credentials are not allowed');
  if (isBlockedHostname(u.hostname)) throw new Error('Private or local hosts are not allowed');
  const host = u.hostname;
  if (net.isIP(host)) {
    if (net.isIP(host) === 4 && isPrivateIPv4(host)) throw new Error('Private network addresses are not allowed');
    if (net.isIP(host) === 6 && isPrivateIPv6(host)) throw new Error('Private network addresses are not allowed');
    return u;
  }
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length) throw new Error('Host could not be resolved');
  for (const {address, family} of addresses) {
    if ((family === 4 && isPrivateIPv4(address)) || (family === 6 && isPrivateIPv6(address))) throw new Error('Private network addresses are not allowed');
  }
  return u;
}

async function readLimited(res: Response) {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error('Source response is too large');
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) throw new Error('Source response is too large');
        chunks.push(value);
      }
    }
  } finally { reader.releaseLock(); }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
  return new TextDecoder().decode(merged);
}

export async function safeFetchText(input: string, init: RequestInit = {}) {
  let current = (await assertSafeUrl(input)).toString();
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await fetch(current, {
      ...init,
      redirect: 'manual',
      headers: { 'user-agent': USER_AGENT, ...(init.headers || {}) },
      signal: init.signal || AbortSignal.timeout(15_000),
    });
    if ([301,302,303,307,308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw new Error('Redirect without location');
      if (i === MAX_REDIRECTS) throw new Error('Too many redirects');
      current = (await assertSafeUrl(new URL(location, current).toString())).toString();
      continue;
    }
    return { response: res, url: current, text: await readLimited(res) };
  }
  throw new Error('Too many redirects');
}
