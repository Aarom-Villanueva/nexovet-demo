import { useCallback } from 'react';
import { useAuth } from './auth';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fields: Record<string, string> = {},
    public code?: string,
  ) {
    super(message);
  }
}
export function useApi() {
  const { session, expire, noteAuthenticated } = useAuth();
  const csrf = session?.csrfToken;
  return useCallback(
    async <T>(
      path: string,
      options: { method?: 'POST' | 'PUT'; body?: unknown; signal?: AbortSignal } = {},
    ): Promise<T> => {
      let response: Response;
      try {
        response = await fetch(path, {
          method: options.method ?? 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          signal: options.signal,
          headers: options.method
            ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' }
            : undefined,
          body: options.method ? JSON.stringify(options.body) : undefined,
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        throw new ApiError(
          'No pudimos conectar. Tus cambios siguen en el formulario; intenta nuevamente.',
          0,
        );
      }
      const data = await response.json().catch(() => null);
      if (response.status === 401) expire();
      if (!response.ok)
        throw new ApiError(
          data?.message ?? 'No se pudo completar la operación.',
          response.status,
          data?.fields ?? {},
          data?.code,
        );
      noteAuthenticated();
      return data as T;
    },
    [csrf, expire, noteAuthenticated],
  );
}
