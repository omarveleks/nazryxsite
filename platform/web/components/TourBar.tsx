import TourSpotlight from './TourSpotlight';
import { TOUR } from '@/lib/tour';

/** The guided tour after sign-up, as a spotlight on the feature this page is about. */
export default function TourBar({ step }: { step: number }) {
  const t = TOUR[step - 1];
  if (!t) return null;
  return <TourSpotlight step={step} total={TOUR.length} target={t.target} title={t.title} text={t.text} tip={t.tip} nextTitle={TOUR[step]?.title} />;
}
