import TourSpotlight, { TourIntro } from './TourSpotlight';
import { TOUR } from '@/lib/tour';
import { tt } from '@/lib/i18n';

/** The guided tour after sign-up: the welcome offer (step -1), then a spotlight on the feature each page is about. */
export default function TourBar({ step, company }: { step: number; company?: string | null }) {
  const t = tt();
  const L = { welcome: t('Welcome'), ask: t('Take a two-minute tour?'), intro: t('We show you each part of Nazryx where it lives: your products, the market, distributors, our services and your plan. You can take it any time from Home.'),
    take: t('Take the tour'), skip: t('Skip for now'), end: t('End tour'), tour: t('Tour'), of: t('of'), back: t('← Back'), finish: t('Finish the tour'), next: t('Next') };
  if (step === -1) return <TourIntro company={company} labels={L} />;
  const s = TOUR[step - 1];
  if (!s) return null;
  return <TourSpotlight step={step} total={TOUR.length} target={s.target} title={t(s.title)} text={t(s.text)} tip={s.tip ? t(s.tip) : undefined} nextTitle={TOUR[step] ? t(TOUR[step].title) : undefined}
    fallback={s.fallback} fallbackText={s.fallbackText ? t(s.fallbackText) : undefined} labels={L} />;
}
