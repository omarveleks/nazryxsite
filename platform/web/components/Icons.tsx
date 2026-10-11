// Nazryx icons: flat, angular, cut from the same slanted geometry as the logo mark. Four in total, used sparingly:
// Demand (high demand), Opening (nobody registered), Verified (checked by our team) and Lock (not in your plan).
type P = { size?: number; title?: string };
const svg = (size: number, title: string | undefined, children: React.ReactNode, w = 16) => (
  <svg width={size} height={size} viewBox={`0 0 ${w} 16`} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}
    aria-label={title} style={{ flex: 'none', display: 'inline-block', verticalAlign: '-2px' }}>{children}</svg>);

/** Three rising, slanted bars. */
export const DemandIcon = ({ size = 13, title }: P) => svg(size, title, <g fill="currentColor">
  <path d="M1 16 L3.5 10 L6 10 L3.5 16 Z" /><path d="M6 16 L9.5 6 L12 6 L8.5 16 Z" /><path d="M11 16 L15.5 1 L16 1 L16 16 Z" /></g>);

/** The logo's notch: an open slot waiting to be filled. */
export const OpeningIcon = ({ size = 13, title }: P) => svg(size, title,
  <path fill="currentColor" d="M0 3 L5 3 L8 8 L11 3 L16 3 L16 13 L12 13 L12 9 L8 15 L4 9 L4 13 L0 13 Z" />);

/** A cut-corner badge with a check. */
export const VerifiedIcon = ({ size = 13, title }: P) => svg(size, title, <g>
  <path fill="currentColor" d="M4 0 L16 0 L16 12 L12 16 L0 16 L0 4 Z" />
  <path fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="square" d="M4.5 8.5 L7 11 L11.5 5.5" /></g>);

/** A squared lock. */
export const LockIcon = ({ size = 12, title }: P) => svg(size, title, <g fill="currentColor">
  <path d="M2 7 L14 7 L14 16 L2 16 Z" /><path d="M4 7 L4 4 L6 1 L10 1 L12 4 L12 7 L10 7 L10 4.5 L9 3 L7 3 L6 4.5 L6 7 Z" /></g>);
