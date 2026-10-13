import { Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Logo } from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '', displayName: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;
  const isLogin = mode === 'login';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = isLogin
        ? await api.login(form.email, form.password)
        : await api.register(form.email, form.password, form.displayName);
      setUser(user);
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6 shadow-sm">
          <div>
            <h1 className="text-xl font-semibold">{isLogin ? 'Sign in' : 'Create an account'}</h1>
            <p className="mt-1 text-sm text-muted">{isLogin ? 'Manage and export stickers for every platform.' : 'Keep your sticker packs and download them again anytime.'}</p>
          </div>
          {!isLogin && (
            <label className="block">
              <span className="label">Display name</span>
              <input className="input" required maxLength={60} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            </label>
          )}
          <label className="block">
            <span className="label">Email</span>
            <input className="input" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">Password</span>
            <input
              className="input"
              type="password"
              required
              minLength={isLogin ? 1 : 8}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p>}
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {isLogin ? 'Sign in' : 'Create account'}
          </button>
          <p className="text-center text-sm text-muted">
            {isLogin ? 'No account yet? ' : 'Already have an account? '}
            <Link to={isLogin ? '/register' : '/login'} className="font-medium text-brand hover:underline">
              {isLogin ? 'Sign up' : 'Sign in'}
            </Link>
          </p>
        </form>
        <p className="mt-6 text-center text-sm text-muted">
          Just need to convert a few files?{' '}
          <Link to="/convert" className="font-medium text-brand hover:underline">
            Use it without an account
          </Link>
        </p>
      </div>
    </div>
  );
}
