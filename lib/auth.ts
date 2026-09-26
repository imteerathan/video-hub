import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const COOKIE = 'vh_session';
const SESSION_DAYS = 30;

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(':');
  if (!salt || !hex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }

export async function register(email: string, password: string, displayName: string) {
  const normalized = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error('Invalid email');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  if (displayName.trim().length < 2) throw new Error('Display name is too short');
  const exists = await db.user.findUnique({ where: { email: normalized } });
  if (exists) throw new Error('Email already registered');
  const user = await db.user.create({ data: { email: normalized, passwordHash: hashPassword(password), displayName: displayName.trim() } });
  await createSession(user.id);
  return user;
}

export async function login(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !verifyPassword(password, user.passwordHash)) throw new Error('Invalid email or password');
  await createSession(user.id);
  return user;
}

async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', expires: expiresAt, path: '/' });
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(COOKIE);
}

export async function getCurrentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt <= new Date()) { await db.session.delete({ where: { id: session.id } }); return null; }
  return session.user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error('UNAUTHENTICATED');
  return user;
}
