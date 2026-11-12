import { useEffect, useState } from 'react';
import type { DemoOverview } from '@nexovet/shared';

export function useOverview() {
  const [data, setData] = useState<DemoOverview | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void fetch('/api/demo/overview', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Vista previa no disponible');
        const value: DemoOverview = await response.json();
        if (value.demo !== true || !value.totals || !Array.isArray(value.appointments))
          throw new Error('Respuesta inesperada');
        setData(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(true);
          setData(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);
  return { data, error, loading, retry: () => setAttempt((value) => value + 1) };
}
