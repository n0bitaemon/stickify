import { Download, History, LayoutGrid, LogOut, Send, Sparkles, Zap } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/', label: 'Sticker packs', icon: LayoutGrid, end: true },
  { to: '/import', label: 'Import', icon: Download },
  { to: '/app/convert', label: 'Quick convert', icon: Zap },
  { to: '/history', label: 'History', icon: History },
  { to: '/telegram', label: 'Telegram', icon: Send },
];

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-9 place-items-center rounded-xl bg-brand text-brand-fg shadow-sm shadow-brand/30">
        <Sparkles className="size-5" />
      </div>
      <span className="text-lg font-semibold tracking-tight">Stickify</span>
    </div>
  );
}

/** App frame: sidebar on desktop, bottom tab bar on mobile. */
export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface p-4 md:flex">
        <div className="px-2 py-1">
          <Logo />
        </div>
        <nav className="mt-8 flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-2 hover:text-fg'
                }`
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-3 rounded-xl border border-line p-3">
          <div className="grid size-8 place-items-center rounded-full bg-surface-2 text-sm font-semibold">
            {user?.displayName.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{user?.displayName}</div>
            <div className="truncate text-xs text-muted">{user?.email}</div>
          </div>
          <button onClick={logout} className="text-muted hover:text-fg" title="Sign out" aria-label="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      <main className="min-w-0 px-4 pt-6 pb-24 md:px-8 md:pb-10">
        <div className="mb-6 flex items-center justify-between md:hidden">
          <Logo />
          <button onClick={logout} className="btn btn-ghost px-3" aria-label="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface/95 backdrop-blur md:hidden">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `flex flex-col items-center gap-1 py-2.5 text-[11px] ${isActive ? 'text-brand' : 'text-muted'}`}
          >
            <Icon className="size-5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
