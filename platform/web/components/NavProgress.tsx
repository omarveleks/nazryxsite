'use client';
import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

// A thin bar at the top the moment a link or form is used, until the next page is on screen: the click always answers.
export default function NavProgress() {
  const path = usePathname(), search = useSearchParams();
  const [on, setOn] = useState(false);
  useEffect(() => { setOn(false); }, [path, search]);
  useEffect(() => { if (!on) return; const t = setTimeout(() => setOn(false), 12000); return () => clearTimeout(t); }, [on]);   // never stuck
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest('a');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      setOn(true);
    };
    const submit = () => setOn(true);
    document.addEventListener('click', click, true);
    document.addEventListener('submit', submit, true);
    return () => { document.removeEventListener('click', click, true); document.removeEventListener('submit', submit, true); };
  }, []);
  return on ? <div className="nav-progress" role="progressbar" aria-label="Loading" /> : null;
}
