'use client';
import { useEffect, useState } from 'react';

/** A time in the reader's own time zone (the server renders the team's zone first, then the browser corrects it). */
export default function LocalTime({ iso, zone, withDate = true }: { iso: string; zone: string; withDate?: boolean }) {
  const fmt = (tz?: string) => new Intl.DateTimeFormat('en-GB', {
    ...(withDate ? { weekday: 'short', day: 'numeric', month: 'short' } : {}), hour: '2-digit', minute: '2-digit', timeZone: tz,
  }).format(new Date(iso));
  const [text, setText] = useState(() => fmt(zone));
  useEffect(() => { setText(fmt()); }, [iso]);   // eslint-disable-line react-hooks/exhaustive-deps
  return <time dateTime={iso} suppressHydrationWarning>{text}</time>;
}
