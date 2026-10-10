import Link from 'next/link';

export default function Brand({ href = '/home', tag = 'Intelligence' }: { href?: string; tag?: string }) {
  return (
    <Link className="brand" href={href}>
      <svg viewBox="0 0 837 346" aria-hidden="true"><path d="M171 0 L403 0 L613 210 L613 0 L837 0 L837 198 L689 346 L461 346 L295 179 L131 346 L0 346 L0 174 Z" fill="#0066FF" /></svg>
      <b>Nazryx</b>{tag && <small>{tag}</small>}
    </Link>
  );
}
