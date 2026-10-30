'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const COOKIE = 'nzx_nav';
const shell = () => document.getElementById('shell');

/** Desktop: fold the sidebar to an icon rail and back. Remembered in a cookie so the page renders folded straight away. `[` toggles. */
export function NavToggle({ hide, show }: { hide: string; show: string }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(shell()?.classList.contains('collapsed') ?? false); }, []);
  const toggle = () => {
    const el = shell(); if (!el) return;
    const c = !el.classList.contains('collapsed');
    el.classList.toggle('collapsed', c);
    document.cookie = `${COOKIE}=${c ? 'collapsed' : 'open'}; path=/; max-age=31536000; samesite=lax`;
    setCollapsed(c);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (e.key === '[' && !e.metaKey && !e.ctrlKey && !e.altKey && !['input', 'textarea', 'select'].includes(tag) && !(document.activeElement as HTMLElement)?.isContentEditable) { e.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, []);
  const label = collapsed ? show : hide;
  return (
    <button type="button" className="nav-toggle" onClick={toggle} aria-expanded={!collapsed} aria-controls="sidenav" aria-label={label} title={`${label} ([)`}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" />{collapsed ? <path d="M14 10l2 2-2 2" /> : <path d="M16 10l-2 2 2 2" />}
      </svg>
    </button>
  );
}

/** Phone: the menu button opens the sidebar as a drawer; the backdrop, Escape, a link or the close button shut it. */
export function MenuButton({ open, close, variant = 'open' }: { open: string; close: string; variant?: 'open' | 'close' }) {
  const path = usePathname();
  const set = (on: boolean) => {
    const el = shell(); if (!el) return;
    el.classList.toggle('nav-open', on);
    document.body.style.overflow = on ? 'hidden' : '';
    if (on) setTimeout(() => el.querySelector<HTMLElement>('#sidenav .nav a.on, #sidenav .nav a')?.focus(), 60);
    else document.getElementById('menu-button')?.focus();
  };
  useEffect(() => { set(false); }, [path]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && shell()?.classList.contains('nav-open')) set(false); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, []);
  if (variant === 'close') {
    return <button type="button" className="nav-toggle m-only" onClick={() => set(false)} aria-label={close} title={close}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>;
  }
  return (<>
    <button type="button" id="menu-button" className="nav-toggle m-only" onClick={() => set(true)} aria-label={open} aria-controls="sidenav" aria-expanded={false} title={open}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg></button>
    <div className="backdrop" onClick={() => set(false)} aria-hidden="true" />
  </>);
}
