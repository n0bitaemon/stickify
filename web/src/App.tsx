import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import { Layout, Logo } from './components/Layout';
import { AuthProvider, useAuth } from './lib/auth';
import { ToastProvider } from './lib/toast';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { ImportPage } from './pages/ImportPage';
import { PackEditorPage } from './pages/PackEditorPage';
import { QuickConvertPage } from './pages/QuickConvertPage';
import { TelegramPage } from './pages/TelegramPage';

function FullScreenSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Loader2 className="size-7 animate-spin text-brand" />
    </div>
  );
}

/** Pages that need an account; signed-out users go to /login. */
function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenSpinner />;
  return user ? children : <Navigate to="/login" replace />;
}

/** /convert also works signed out (a simple frame without the sidebar). */
function PublicConvert() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenSpinner />;
  if (user) return <Navigate to="/app/convert" replace />;
  return (
    <div className="min-h-dvh px-4 py-6 md:px-8">
      <header className="mx-auto mb-8 flex max-w-6xl items-center justify-between">
        <Logo />
        <div className="flex gap-2">
          <Link to="/login" className="btn btn-ghost">
            Sign in
          </Link>
          <Link to="/register" className="btn btn-primary">
            Sign up
          </Link>
        </div>
      </header>
      <QuickConvertPage />
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/register" element={<AuthPage mode="register" />} />
            <Route path="/convert" element={<PublicConvert />} />
            <Route
              element={
                <Protected>
                  <Layout />
                </Protected>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="packs/:id" element={<PackEditorPage />} />
              <Route path="app/convert" element={<QuickConvertPage />} />
              <Route path="import" element={<ImportPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="telegram" element={<TelegramPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
