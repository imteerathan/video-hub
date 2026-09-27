'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const POLL_MS = 2500;

export default function LiveSync() {
  const router = useRouter();
  const versionRef = useRef<string | null>(null);
  const refreshingRef = useRef(false);

  useEffect(() => {
    let disposed = false;

    const refreshVersion = async () => {
      try {
        const response = await fetch('/api/sync/version', { cache: 'no-store' });
        if (!response.ok || disposed) return;
        const payload = await response.json();
        if (!payload?.version) return;

        if (versionRef.current === null) {
          versionRef.current = payload.version;
          return;
        }

        if (payload.version !== versionRef.current && !refreshingRef.current) {
          versionRef.current = payload.version;
          refreshingRef.current = true;
          router.refresh();
          window.setTimeout(() => {
            refreshingRef.current = false;
          }, 600);
        }
      } catch {
        // Live sync is additive. A temporary network failure must never interrupt the UI.
      }
    };

    void refreshVersion();
    const timer = window.setInterval(() => void refreshVersion(), POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshVersion();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router]);

  return null;
}
