import { useEffect, useState } from 'react';
import type { DemoOverview } from '@nexovet/shared';
import { useAuth } from './auth';
import { useLocation } from 'react-router-dom';

export function useOverview() {
  const auth = useAuth();
  const { pathname } = useLocation();
  const { expire, noteAuthenticated } = auth;
  const [data, setData] = useState<DemoOverview | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const refresh = () => setAttempt((value) => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void fetch('/api/overview', {
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'same-origin',
    })
      .then(async (response) => {
        if (response.status === 401) {
          expire();
          throw new Error('Sesión terminada');
        }
        if (!response.ok) throw new Error('Vista previa no disponible');
        const value: DemoOverview = await response.json();
        if (typeof value.demo !== 'boolean' || !value.totals || !Array.isArray(value.appointments))
          throw new Error('Respuesta inesperada');
        if (!controller.signal.aborted) {
          setData(value);
          noteAuthenticated();
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt, pathname, expire, noteAuthenticated]);
  return { data, error, loading, retry: () => setAttempt((value) => value + 1) };
}
