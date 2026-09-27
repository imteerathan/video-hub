export type ScanPhase =
  | 'queued'
  | 'fetching'
  | 'extracting'
  | 'matching'
  | 'saving'
  | 'complete'
  | 'error';

export type ScanStatus = {
  sourceId: string;
  sourceName?: string;
  phase: ScanPhase;
  percent: number;
  message: string;
  startedAt: string;
  updatedAt: string;
  discovered: number;
  matched: number;
  created: number;
  updated: number;
  skippedByDate: number;
  unmatched: number;
  duplicates: number;
  result?: Record<string, unknown>;
  error?: string;
};

const states = new Map<string, ScanStatus>();
const RETAIN_MS = 30 * 60_000;

function key(userId: string, sourceId: string) {
  return userId + ':' + sourceId;
}

function prune() {
  const cutoff = Date.now() - RETAIN_MS;
  for (const [k, state] of states) {
    if (Date.parse(state.updatedAt) < cutoff && (state.phase === 'complete' || state.phase === 'error')) {
      states.delete(k);
    }
  }
}

export function startScanStatus(userId: string, sourceId: string, sourceName?: string) {
  prune();
  const now = new Date().toISOString();
  const state: ScanStatus = {
    sourceId,
    sourceName,
    phase: 'queued',
    percent: 2,
    message: 'Scan queued. Preparing source…',
    startedAt: now,
    updatedAt: now,
    discovered: 0,
    matched: 0,
    created: 0,
    updated: 0,
    skippedByDate: 0,
    unmatched: 0,
    duplicates: 0,
  };
  states.set(key(userId, sourceId), state);
  return state;
}

export function setScanStatus(
  userId: string,
  sourceId: string,
  patch: Partial<Omit<ScanStatus, 'sourceId' | 'startedAt'>>,
) {
  const k = key(userId, sourceId);
  const existing = states.get(k);
  if (!existing) return null;
  const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  states.set(k, next);
  return next;
}

export function getScanStatus(userId: string, sourceId: string) {
  prune();
  return states.get(key(userId, sourceId)) ?? null;
}

export function finishScanStatus(
  userId: string,
  sourceId: string,
  result: Record<string, unknown>,
) {
  const discovered = Number(result.discovered ?? 0);
  return setScanStatus(userId, sourceId, {
    phase: 'complete',
    percent: 100,
    message: 'Scan complete. Found ' + discovered + ' media source' + (discovered === 1 ? '' : 's') + '.',
    result,
    discovered,
    matched: Number(result.matched ?? 0),
    created: Number(result.created ?? 0),
    updated: Number(result.updated ?? 0),
    skippedByDate: Number(result.skippedByDate ?? 0),
    unmatched: Number(result.unmatched ?? 0),
    duplicates: Number(result.duplicates ?? 0),
  });
}

export function failScanStatus(userId: string, sourceId: string, error: string) {
  return setScanStatus(userId, sourceId, {
    phase: 'error',
    percent: 100,
    message: 'Scan failed: ' + error,
    error,
  });
}
