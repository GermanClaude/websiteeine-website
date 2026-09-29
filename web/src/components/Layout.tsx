import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation, useNavigate, useNavigation } from 'react-router';

import { useAuth } from '../auth/useAuth';
import { NAV_SECTIONS, filterNav, navLabelForPath } from '../nav';
import { IconButton } from './Button';
import { APP_NAME } from './PageHeader';
import { StatusBadge } from './StatusBadge';
import { useTheme } from './ThemeProvider';
import { CloseIcon, useToast } from './Toasts';

/** Root of the route tree: just the outlet plus scroll restoration. */
export function RootLayout() {
  return (
    <>
      <Outlet />
      <ScrollRestoration />
    </>
  );
}

/** Centered card shell for login / registration / password pages. */
export function AuthLayout() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark />
          {APP_NAME}
        </div>
        <Outlet />
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <span className="app-brand-mark" aria-hidden="true">
      TN
    </span>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="10" cy="10" r="3.5" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M16 12.5A7 7 0 0 1 7.5 4a7 7 0 1 0 8.5 8.5z" strokeLinejoin="round" />
    </svg>
  );
}

export function ThemeToggle() {
  const theme = useTheme();
  const dark = theme.resolved === 'dark';
  return (
    <IconButton label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={theme.toggle} aria-pressed={dark}>
      {dark ? <SunIcon /> : <MoonIcon />}
    </IconButton>
  );
}

function UserMenu() {
  const auth = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (container.current !== null && !container.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (auth.user === null) {
    return (
      <Link to="/login" className="btn btn-primary btn-sm">
        Sign in
      </Link>
    );
  }

  const onLogout = async () => {
    setOpen(false);
    await auth.logout();
    toast.info('You have been signed out.');
    void navigate('/login', { replace: true });
  };

  return (
    <div className="user-menu" ref={container}>
      <button type="button" className="user-menu-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="user-menu-name">{auth.user.username}</span>
        <StatusBadge kind="userRole" value={auth.user.role} />
      </button>
      {open && (
        <ul className="menu" role="menu">
          <li className="menu-meta" role="none">
            {auth.user.email}
          </li>
          <li role="none">
            <Link to="/account" className="menu-item" role="menuitem" onClick={() => setOpen(false)}>
              Profile
            </Link>
          </li>
          <li role="none">
            <Link to="/account/security" className="menu-item" role="menuitem" onClick={() => setOpen(false)}>
              Security
            </Link>
          </li>
          <li role="none">
            <button type="button" className="menu-item" role="menuitem" onClick={() => void onLogout()}>
              Sign out
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

/** Application shell: sidebar navigation (permission-filtered), top bar, content outlet. */
export function AppLayout() {
  const auth = useAuth();
  const location = useLocation();
  const navigation = useNavigation();
  const [navOpen, setNavOpen] = useState(false);

  const sections = filterNav(NAV_SECTIONS, {
    authenticated: auth.status === 'authenticated',
    permissions: auth.permissions,
    hasServerMembership: auth.hasServerMembership,
  });
  const title = navLabelForPath(NAV_SECTIONS, location.pathname) ?? APP_NAME;

  // Close the drawer on navigation.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {navOpen && <button type="button" className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}
      <aside className={navOpen ? 'app-sidebar is-open' : 'app-sidebar'} aria-label="Sidebar">
        <div className="app-sidebar-header">
          <Link to="/" className="app-brand">
            <BrandMark />
            Trust Network
          </Link>
          <IconButton label="Close navigation" className="sidebar-close" onClick={() => setNavOpen(false)}>
            <CloseIcon />
          </IconButton>
        </div>
        <nav className="app-nav" aria-label="Main navigation">
          {sections.map((section) => (
            <div className="nav-section" key={section.title}>
              <div className="nav-section-title">{section.title}</div>
              {section.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="app-sidebar-footer">Centralized transparency, decentralized enforcement.</div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <IconButton label="Open navigation" className="nav-toggle" onClick={() => setNavOpen(true)} aria-expanded={navOpen}>
            <MenuIcon />
          </IconButton>
          <div className="topbar-title">{title}</div>
          <div className="topbar-actions">
            {navigation.state === 'loading' && <span className="spinner spinner-sm" role="status" aria-label="Loading page" />}
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        {auth.mfaEnrollmentRequired && (
          <div className="alert alert-warning" style={{ borderRadius: 0, borderLeft: 0, borderRight: 0 }} role="status">
            <strong>Two-factor authentication required.</strong> Your role requires 2FA. Enable it under{' '}
            <Link to="/account/security">Security</Link> to unlock the rest of the panel.
          </div>
        )}
        <main className="app-content" id="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
