import Link from 'next/link';

/** "Export to Excel" for paid plans; free plans see it marked Paid and go to the plans page. */
export default function ExportLink({ href, paid }: { href: string; paid: boolean }) {
  return paid ? <a className="btn btn-ghost btn-sm" href={href}>Export to Excel</a>
    : <Link className="btn btn-ghost btn-sm" href="/settings#plan">Export · Paid</Link>;
}
