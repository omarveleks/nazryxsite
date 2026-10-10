import Link from 'next/link';
import Brand from '@/components/Brand';
export default function NotFound() {
  return (
    <div className="wrap-narrow"><Brand />
      <h1>Page not found</h1><p className="muted">It may have moved, or you may not have access.</p>
      <Link className="btn btn-blue" href="/home" style={{ alignSelf: 'flex-start' }}>Go home</Link></div>
  );
}
