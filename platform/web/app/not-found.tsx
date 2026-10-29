import Link from 'next/link';
import Brand from '@/components/Brand';
export default function NotFound() {
  return (
    <main className="wrap-narrow" id="main"><Brand />
      <h1>Page not found</h1><p className="muted">It may have moved, or you may not have access.</p>
      <Link className="btn btn-blue" href="/" style={{ alignSelf: 'flex-start' }}>Go home</Link></main>
  );
}
