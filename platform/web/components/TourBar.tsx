import TourSpotlight, { TourIntro } from './TourSpotlight';
import { TOUR } from '@/lib/tour';

/** The guided tour after sign-up: the welcome offer (step -1), then a spotlight on the feature each page is about. */
export default function TourBar({ step, company }: { step: number; company?: string | null }) {
  if (step === -1) return <TourIntro company={company} />;
  const t = TOUR[step - 1];
  if (!t) return null;
  return <TourSpotlight step={step} total={TOUR.length} target={t.target} title={t.title} text={t.text} tip={t.tip} nextTitle={TOUR[step]?.title}
    fallback={t.fallback} fallbackText={t.fallbackText} />;
}
