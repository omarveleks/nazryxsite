import Link from 'next/link';
import { enrich } from '@/app/actions/app';

/** Opening a molecule spends one credit on the free plan (once per molecule). Paid plans open freely. */
export default function EnrichButton({ id, enriched, free }: { id: number; enriched: boolean; free: boolean }) {
  if (enriched || !free) return <Link className="btn btn-ghost btn-sm" href={`/molecule/${id}`}>Open</Link>;
  return (
    <form action={enrich}>
      <input type="hidden" name="molecule_id" value={id} />
      <button className="btn btn-blue btn-sm" type="submit">Enrich, 1 credit</button>
    </form>
  );
}
