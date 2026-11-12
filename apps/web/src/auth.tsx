import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type FormEvent,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, PawPrint, ArrowRight, ShieldCheck } from 'lucide-react';
import type { AuthSession } from '@nexovet/shared';
import petsImage from '../../../assets/nexovet-pets.webp';

interface AuthState {
  session: AuthSession | null;
  loading: boolean;
  unavailable: boolean;
  expired: boolean;
  reload: () => void;
  expire: () => void;
  noteAuthenticated: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthState | null>(null);
export const useAuth = () => {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('Falta AuthProvider');
  return auth;
};
export async function authRequest(path: string, body: unknown, csrfToken?: string) {
  const response = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message ?? 'No pudimos conectar. Intenta nuevamente.');
  return data as AuthSession & { message: string };
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [expired, setExpired] = useState(false);
  const [lastAuthenticated, setLastAuthenticated] = useState(Date.now);
  const noteAuthenticated = useCallback(() => setLastAuthenticated(Date.now()), []);
  const expire = useCallback(() => {
    setSession(null);
    setExpired(true);
  }, []);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(
      expire,
      Math.max(0, lastAuthenticated + 30 * 60 * 1000 - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [session, lastAuthenticated, expire]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setUnavailable(false);
    void fetch('/api/auth/session', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          setSession(null);
          return;
        }
        if (!response.ok) throw new Error('Servicio no disponible');
        const data: AuthSession = await response.json();
        if (!controller.signal.aborted) {
          setSession(data);
          noteAuthenticated();
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setUnavailable(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt, noteAuthenticated]);
  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        unavailable,
        expired,
        reload: () => setAttempt((x) => x + 1),
        expire,
        noteAuthenticated,
        login: async (email, password) => {
          const value = await authRequest('login', { email, password });
          setSession(value);
          noteAuthenticated();
          setExpired(false);
        },
        logout: async () => {
          const response = await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-CSRF-Token': session?.csrfToken ?? '' },
          });
          if (!response.ok && response.status !== 401)
            throw new Error('No se pudo cerrar la sesión. Intenta nuevamente.');
          setSession(null);
          setExpired(false);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function LoginPage() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const mode =
    location.pathname === '/recuperar'
      ? 'forgot'
      : location.pathname === '/restablecer'
        ? 'reset'
        : 'login';
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '',
  );
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (mode === 'reset' && window.location.hash)
      window.history.replaceState(null, '', window.location.pathname);
  }, [mode]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'login') {
        await auth.login(String(form.get('email')), String(form.get('password')));
        if (location.pathname === '/ingresar') navigate('/', { replace: true });
      } else if (mode === 'forgot') {
        const response = await authRequest('forgot-password', { email: form.get('email') });
        setMessage(response.message);
      } else {
        if (form.get('password') !== form.get('confirm'))
          throw new Error('Las contraseñas no coinciden.');
        const response = await authRequest('reset-password', {
          token,
          password: form.get('password'),
        });
        setMessage(response.message);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No pudimos conectar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-layout">
      <section className="login-story" aria-label="Bienvenido a NexoVet">
        <img className="login-photo" src={petsImage} alt="Perros y gatos juntos en un jardín" />
        <div className="login-shade" />
        <Link to="/ingresar" className="login-brand">
          <span>
            <PawPrint size={26} />
          </span>
          NexoVet
        </Link>
        <div className="login-story-copy">
          <span className="login-kicker">CUIDAMOS CONTIGO</span>
          <h1>
            Su bienestar.
            <br />
            Tu mejor equipo.
          </h1>
          <p>Todo lo que necesitas para acompañar a cada mascota, desde su primera visita.</p>
          <span className="login-photo-caption">
            <span /> El cuidado empieza con una buena conexión.
          </span>
        </div>
      </section>
      <main className="login-main">
        <div className="login-card">
          <span className="login-form-icon">
            <PawPrint size={27} />
          </span>
          <span className="eyebrow">BIENVENIDO A NEXOVET</span>
          <h2>
            {mode === 'login'
              ? 'Qué bueno verte de nuevo.'
              : mode === 'forgot'
                ? 'Recupera tu acceso.'
                : 'Una nueva contraseña.'}
          </h2>
          <p className="login-description">
            {mode === 'login'
              ? 'Ingresa con tu cuenta para empezar a cuidar.'
              : mode === 'forgot'
                ? 'Te enviaremos un enlace si tu cuenta tiene acceso habilitado.'
                : 'Elige una contraseña de 12 a 128 caracteres.'}
          </p>
          {auth.expired && mode === 'login' && (
            <p className="auth-notice" role="status">
              Tu sesión terminó. Ingresa para continuar.
            </p>
          )}
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="auth-notice" role="status">
              {message}
            </p>
          )}
          {mode === 'reset' && !token ? (
            <p className="auth-error" role="alert">
              Abre el enlace de recuperación recibido en tu correo.{' '}
              <Link to="/recuperar">Solicitar otro enlace</Link>
            </p>
          ) : (
            !message && (
              <form onSubmit={(event) => void submit(event)}>
                {mode !== 'reset' && (
                  <label className="auth-field">
                    Correo electrónico
                    <input
                      name="email"
                      type="email"
                      autoComplete="username"
                      required
                      maxLength={254}
                      placeholder="tu@veterinaria.com"
                      disabled={busy}
                    />
                  </label>
                )}
                {mode !== 'forgot' && (
                  <label className="auth-field">
                    {mode === 'reset' ? 'Nueva contraseña' : 'Contraseña'}
                    <div className="password-field">
                      <input
                        name="password"
                        type={show ? 'text' : 'password'}
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        required
                        minLength={mode === 'reset' ? 12 : 1}
                        maxLength={128}
                        disabled={busy}
                      />
                      <button
                        type="button"
                        aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        aria-pressed={show}
                        onClick={() => setShow(!show)}
                      >
                        {show ? <EyeOff size={19} /> : <Eye size={19} />}
                      </button>
                    </div>
                  </label>
                )}
                {mode === 'reset' && (
                  <label className="auth-field">
                    Confirma la contraseña
                    <input
                      name="confirm"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={12}
                      maxLength={128}
                      disabled={busy}
                    />
                  </label>
                )}
                {mode === 'login' && (
                  <Link className="auth-forgot" to="/recuperar">
                    ¿Olvidaste tu contraseña?
                  </Link>
                )}
                <button className="button auth-submit" disabled={busy} type="submit">
                  {busy
                    ? 'Un momento…'
                    : mode === 'login'
                      ? 'Ingresar'
                      : mode === 'forgot'
                        ? 'Enviar enlace'
                        : 'Guardar contraseña'}
                  {!busy && <ArrowRight size={18} />}
                </button>
              </form>
            )
          )}
          {mode !== 'login' && (
            <Link className="auth-back" to="/ingresar">
              Volver a ingresar
            </Link>
          )}
          <p className="login-secure">
            <ShieldCheck size={16} /> Acceso exclusivo para el equipo de la veterinaria
          </p>
        </div>
        <footer className="login-footer">NexoVet · Hecho para cuidar</footer>
      </main>
    </div>
  );
}
