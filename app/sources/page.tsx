'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Cat = { id: string; name: string };
type Source = {
  id: string;
  name: string;
  url: string;
  scanWindow: number;
  scanIntervalHours: number;
  enabled: boolean;
  lastScannedAt: string | null;
  lastError: string | null;
  lastScanCount: number;
  categories: { category: Cat }[];
};
type EditState = {
  id: string;
  name: string;
  url: string;
  scanWindow: string;
  interval: string;
  categoryIds: string[];
  enabled: boolean;
};
type ScanResult = {
  sourceId: string;
  scanned: number;
  discovered: number;
  matched: number;
  created: number;
  updated: number;
  skippedByDate: number;
  unmatched: number;
  duplicates: number;
  durationMs: number;
  finalMessage?: string;
};
type ScanStatus = {
  sourceId: string;
  sourceName?: string;
  phase: 'queued' | 'fetching' | 'extracting' | 'matching' | 'saving' | 'complete' | 'error';
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
  result?: ScanResult;
  error?: string;
};
type ActionStatus = {
  busy: boolean;
  message: string;
  tone: 'info' | 'ok' | 'error';
};

const windows = ['7', '15', '30'];
const intervals = [
  ['6', 'every 6 hours'],
  ['12', 'every 12 hours'],
  ['24', 'daily'],
  ['48', 'every 2 days'],
  ['168', 'weekly'],
];

const phaseLabel: Record<ScanStatus['phase'], string> = {
  queued: 'QUEUED',
  fetching: 'FETCHING',
  extracting: 'EXTRACTING',
  matching: 'MATCHING',
  saving: 'SAVING',
  complete: 'COMPLETE',
  error: 'ERROR',
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminal(status?: ScanStatus | null) {
  return status?.phase === 'complete' || status?.phase === 'error';
}

export default function Sources() {
  const [sources, setSources] = useState<Source[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [window, setWindow] = useState('30');
  const [selected, setSelected] = useState<string[]>([]);
  const [interval, setInterval] = useState('24');
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanStates, setScanStates] = useState<Record<string, ScanStatus | undefined>>({});
  const [scanResults, setScanResults] = useState<Record<string, ScanResult | undefined>>({});
  const [actionStatus, setActionStatus] = useState<ActionStatus>({
    busy: true,
    message: 'Loading Sources and Categories…',
    tone: 'info',
  });
  const router = useRouter();

  async function load() {
    try {
      const [a, b] = await Promise.all([
        fetch('/api/sources', { cache: 'no-store' }),
        fetch('/api/categories', { cache: 'no-store' }),
      ]);
      if (a.status === 401) {
        router.push('/login');
        return;
      }
      setSources(await a.json());
      setCats(await b.json());
      setActionStatus({
        busy: false,
        message: 'Ready. Source controls are connected.',
        tone: 'ok',
      });
    } catch {
      setActionStatus({
        busy: false,
        message: 'Could not load Sources. Check the app connection and try again.',
        tone: 'error',
      });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    setActionStatus({ busy: true, message: 'Saving new Source…', tone: 'info' });
    try {
      const r = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          url,
          scanWindow: Number(window),
          scanIntervalHours: Number(interval),
          categoryIds: selected,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || 'Failed to save source');
        setActionStatus({ busy: false, message: j.error || 'Save failed.', tone: 'error' });
        return;
      }
      setName('');
      setUrl('');
      setSelected([]);
      setActionStatus({ busy: false, message: 'Source saved successfully.', tone: 'ok' });
      await load();
    } catch {
      setActionStatus({ busy: false, message: 'Save failed. Check the app connection.', tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function scan(id: string, sourceName: string) {
    setError('');
    setScanResults((current) => ({ ...current, [id]: undefined }));
    setScanStates((current) => ({
      ...current,
      [id]: {
        sourceId: id,
        sourceName,
        phase: 'queued',
        percent: 2,
        message: 'Starting scan…',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        discovered: 0,
        matched: 0,
        created: 0,
        updated: 0,
        skippedByDate: 0,
        unmatched: 0,
        duplicates: 0,
      },
    }));
    setActionStatus({ busy: true, message: 'Scan started for “' + sourceName + '”.', tone: 'info' });

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30 * 60_000);
    let requestDone = false;

    try {
      const requestPromise = fetch('/api/scan-source', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId: id }),
        signal: controller.signal,
      }).finally(() => {
        requestDone = true;
      });

      while (!requestDone) {
        try {
          const sr = await fetch('/api/scan-source/status?sourceId=' + encodeURIComponent(id), {
            cache: 'no-store',
          });
          if (sr.ok) {
            const sj = await sr.json();
            if (sj.status) {
              setScanStates((current) => ({ ...current, [id]: sj.status }));
              if (isTerminal(sj.status)) break;
            }
          }
        } catch {
          // Keep the visible queued state while the main scan request is running.
        }
        if (requestDone) break;
        await sleep(450);
      }

      const r = await requestPromise;
      const j = await r.json().catch(() => ({}));

      if (!r.ok) {
        const message = j.error || 'Scan failed';
        setError(message);
        setScanStates((current) => ({
          ...current,
          [id]: {
            ...(current[id] as ScanStatus),
            phase: 'error',
            percent: 100,
            message: 'Scan failed: ' + message,
            error: message,
          },
        }));
        setActionStatus({ busy: false, message: 'Scan failed for “' + sourceName + '”.', tone: 'error' });
        return;
      }

      setScanResults((current) => ({ ...current, [id]: j }));
      const sr = await fetch('/api/scan-source/status?sourceId=' + encodeURIComponent(id), {
        cache: 'no-store',
      }).catch(() => null);
      if (sr?.ok) {
        const sj = await sr.json().catch(() => ({}));
        if (sj.status) setScanStates((current) => ({ ...current, [id]: sj.status }));
      }

      setActionStatus({
        busy: false,
        message: 'Scan finished for “' + sourceName + '”. The scan report explains what the scanner found.',
        tone: 'ok',
      });
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Scan failed';
      setError(message);
      setScanStates((current) => ({
        ...current,
        [id]: {
          ...(current[id] as ScanStatus),
          phase: 'error',
          percent: 100,
          message: 'Scan failed: ' + message,
          error: message,
        },
      }));
      setActionStatus({ busy: false, message: 'Scan failed for “' + sourceName + '”.', tone: 'error' });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function remove(id: string, sourceName: string) {
    if (!confirm('Delete this source?')) return;
    setError('');
    setActionStatus({ busy: true, message: 'Deleting “' + sourceName + '”…', tone: 'info' });
    try {
      const r = await fetch('/api/sources?id=' + id, { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Delete failed');
      }
      if (edit?.id === id) setEdit(null);
      setActionStatus({ busy: false, message: 'Source deleted successfully.', tone: 'ok' });
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Delete failed';
      setActionStatus({ busy: false, message, tone: 'error' });
    }
  }

  function startEdit(s: Source) {
    setError('');
    setEdit({
      id: s.id,
      name: s.name,
      url: s.url,
      scanWindow: String(s.scanWindow),
      interval: String(s.scanIntervalHours || 24),
      categoryIds: s.categories.map((x) => x.category.id),
      enabled: s.enabled,
    });
    setActionStatus({ busy: false, message: 'Editing “' + s.name + '”.', tone: 'info' });
  }

  async function saveEdit() {
    if (!edit) return;
    setSaving(true);
    setError('');
    setActionStatus({ busy: true, message: 'Saving Source changes…', tone: 'info' });
    try {
      const r = await fetch('/api/sources', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: edit.id,
          name: edit.name,
          url: edit.url,
          scanWindow: Number(edit.scanWindow),
          scanIntervalHours: Number(edit.interval),
          categoryIds: edit.categoryIds,
          enabled: edit.enabled,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || 'Failed to update source');
        setActionStatus({ busy: false, message: j.error || 'Update failed.', tone: 'error' });
        return;
      }
      setEdit(null);
      setActionStatus({ busy: false, message: 'Source changes saved.', tone: 'ok' });
      await load();
    } catch {
      setActionStatus({ busy: false, message: 'Update failed. Check the app connection.', tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(s: Source) {
    setError('');
    const nextEnabled = !s.enabled;
    setActionStatus({
      busy: true,
      message: (nextEnabled ? 'Enabling “' : 'Pausing “') + s.name + '”…',
      tone: 'info',
    });
    try {
      const r = await fetch('/api/sources', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: s.id,
          enabled: nextEnabled,
          name: s.name,
          url: s.url,
          scanWindow: s.scanWindow,
          scanIntervalHours: s.scanIntervalHours,
          categoryIds: s.categories.map((x) => x.category.id),
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Failed to update source');
      }
      setActionStatus({
        busy: false,
        message: 'Source ' + (nextEnabled ? 'enabled' : 'paused') + '.',
        tone: 'ok',
      });
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to update source';
      setActionStatus({ busy: false, message, tone: 'error' });
    }
  }

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <div className="eyebrow">CONTENT SOURCES</div>
          <h1>Sources</h1>
          <p className="muted">
            Add websites once. Edit their scan policy, categories, or enabled state at any time.
          </p>
        </div>
      </div>

      <section className={'action-status ' + actionStatus.tone + (actionStatus.busy ? ' busy' : '')}>
        <span className="status-dot" aria-hidden="true" />
        <strong>{actionStatus.busy ? 'Working' : 'Status'}</strong>
        <span>{actionStatus.message}</span>
      </section>

      <section className="form-card">
        <h2>Add source</h2>
        <div className="form-grid">
          <input className="input" placeholder="Source name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} />
          <select className="input" value={window} onChange={(e) => setWindow(e.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="15">Last 15 days</option>
            <option value="30">Last 30 days</option>
          </select>
          <select className="input" value={interval} onChange={(e) => setInterval(e.target.value)}>
            {intervals.map(([v, l]) => (
              <option key={v} value={v}>Scan {l}</option>
            ))}
          </select>
        </div>

        <div className="label">Categories</div>
        <div className="check-grid">
          {cats.map((c) => (
            <label key={c.id} className="check">
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={(e) =>
                  setSelected((v) => (e.target.checked ? [...v, c.id] : v.filter((x) => x !== c.id)))
                }
              />
              {c.name}
            </label>
          ))}
          {!cats.length && <span className="muted">Create categories first if you want to tag this source.</span>}
        </div>

        <button className="btn" onClick={add} disabled={saving}>
          {saving ? 'Saving…' : 'Save source'}
        </button>
        {error && <p className="error">{error}</p>}
      </section>

      <div className="grid">
        {sources.map((s) => {
          const scanState = scanStates[s.id];
          const result = scanResults[s.id] || scanState?.result;
          const scanning = !!scanState && !isTerminal(scanState);
          const progress = Math.max(0, Math.min(100, scanState?.percent ?? 0));

          return (
            <article className="card" key={s.id}>
              <div className="row space">
                <div>
                  <h3>{s.name}</h3>
                  <div className="muted wrap">{s.url}</div>
                </div>
                <span className={s.enabled ? 'ok' : 'muted'}>{s.enabled ? 'Enabled' : 'Paused'}</span>
              </div>

              <p>
                Scan window: <strong>{s.scanWindow} days</strong> · Schedule:{' '}
                <strong>{s.scanIntervalHours ? 'every ' + s.scanIntervalHours + 'h' : 'daily'}</strong>
              </p>

              <div>
                {s.categories.map((c) => (
                  <span className="tag" key={c.category.id}>{c.category.name}</span>
                ))}
              </div>

              <p className="muted small">{s.lastScanCount || 0} items found on last scan</p>

              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn secondary" onClick={() => void scan(s.id, s.name)} disabled={!s.enabled || scanning}>
                  {scanning ? 'Scanning…' : 'Scan now'}
                </button>
                <button className="btn secondary" onClick={() => startEdit(s)} disabled={scanning}>Edit</button>
                <button
                  className="iconbtn"
                  onClick={() => void toggleEnabled(s)}
                  disabled={scanning}
                  aria-label={s.enabled ? 'Pause source' : 'Enable source'}
                >
                  {s.enabled ? 'Ⅱ' : '▶'}
                </button>
                <button
                  className="iconbtn"
                  onClick={() => void remove(s.id, s.name)}
                  disabled={scanning}
                  aria-label={'Delete ' + s.name}
                >
                  ×
                </button>
              </div>

              {scanState && (
                <div className={'scan-status-card ' + (scanState.phase === 'error' ? 'has-error' : '')}>
                  <div className="scan-status-top">
                    <div>
                      <strong>Scan Status</strong>
                      <div className="muted small">{phaseLabel[scanState.phase]}</div>
                    </div>
                    <strong>{progress}%</strong>
                  </div>

                  <div
                    className="scan-progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                    aria-label={'Scan progress for ' + s.name}
                  >
                    <div style={{ width: progress + '%' }} />
                  </div>

                  <p className="scan-message">{scanState.message}</p>

                  <div className="scan-metrics">
                    <span>Discovered <strong>{scanState.discovered}</strong></span>
                    <span>Matched <strong>{scanState.matched}</strong></span>
                    <span>New <strong>{scanState.created}</strong></span>
                    <span>Updated <strong>{scanState.updated}</strong></span>
                    <span>Old <strong>{scanState.skippedByDate}</strong></span>
                    <span>Unmatched <strong>{scanState.unmatched}</strong></span>
                    <span>Duplicates <strong>{scanState.duplicates}</strong></span>
                  </div>

                  {scanState.error && <p className="error">{scanState.error}</p>}

                  {result && (
                    <div className="scan-report">
                      <strong>Scan report</strong>
                      <p className="muted small">
                        {result.finalMessage || 'Scan finished.'} Duration: {(result.durationMs / 1000).toFixed(1)}s.
                      </p>
                      {result.discovered === 0 && (
                        <p className="scan-diagnostic">
                          No direct media URL was exposed in the returned HTML. This is evidence that the page may use
                          a dynamic player, iframe, or API that the current basic extractor does not inspect.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <p className={s.lastError ? 'error' : 'ok'}>
                {s.lastError ||
                  (s.lastScannedAt ? 'Last scan ' + new Date(s.lastScannedAt).toLocaleString() : 'Ready for first scan')}
              </p>

              {edit?.id === s.id && (
                <div className="form-card editor-panel">
                  <h3>Edit source</h3>
                  <div className="form-grid">
                    <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                    <input className="input" value={edit.url} onChange={(e) => setEdit({ ...edit, url: e.target.value })} />
                    <select className="input" value={edit.scanWindow} onChange={(e) => setEdit({ ...edit, scanWindow: e.target.value })}>
                      {windows.map((v) => <option key={v} value={v}>Last {v} days</option>)}
                    </select>
                    <select className="input" value={edit.interval} onChange={(e) => setEdit({ ...edit, interval: e.target.value })}>
                      {intervals.map(([v, l]) => <option key={v} value={v}>Scan {l}</option>)}
                    </select>
                  </div>

                  <div className="label">Categories</div>
                  <div className="check-grid">
                    {cats.map((c) => (
                      <label key={c.id} className="check">
                        <input
                          type="checkbox"
                          checked={edit.categoryIds.includes(c.id)}
                          onChange={(e) =>
                            setEdit({
                              ...edit,
                              categoryIds: e.target.checked
                                ? [...edit.categoryIds, c.id]
                                : edit.categoryIds.filter((x) => x !== c.id),
                            })
                          }
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>

                  <label className="check">
                    <input
                      type="checkbox"
                      checked={edit.enabled}
                      onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })}
                    />
                    Enabled
                  </label>

                  <div className="row">
                    <button className="btn" onClick={() => void saveEdit()} disabled={saving}>
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>
                    <button className="btn secondary" onClick={() => setEdit(null)} disabled={saving}>Cancel</button>
                  </div>
                </div>
              )}
            </article>
          );
        })}

        {!sources.length && <div className="empty">No sources yet.</div>}
      </div>
    </main>
  );
}
