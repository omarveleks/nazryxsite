// The tender desk: what a bid usually needs in each market, and a bid or no-bid reading from past awards.

/** The documents a medicine tender in a market usually asks for. Kept short and general; the notice itself rules. */
export const TENDER_DOCS: Record<string, string[]> = {
  TZ: ['Valid TMDA registration certificate for each item', 'Manufacturer’s authorisation to bid', 'GMP certificate and CPP', 'Tax clearance and business licence of the bidder', 'Bid security where the notice asks for it', 'Samples with certificates of analysis', 'Price schedule in the required currency, CIF or DDP as stated'],
  KE: ['Valid PPB registration for each item', 'Manufacturer’s authorisation', 'GMP certificate and CPP', 'KRA tax compliance certificate', 'Bid bond where the notice asks for it', 'Samples and certificates of analysis', 'Priced schedule and delivery terms'],
  KZ: ['Registration certificate (Kazakhstan or EAEU) for each item', 'GMP certificate recognised in Kazakhstan', 'Declaration of conformity', 'Price not above the registered ceiling price', 'Supplier qualification documents on the SK-Pharmacy portal', 'Delivery schedule by region'],
  KG: ['Registration certificate for each item', 'GMP certificate and CPP', 'Supplier qualification documents', 'Price schedule and delivery terms'],
  UZ: ['Registration certificate for each item', 'GMP certificate and CPP', 'Supplier registration on UZEX', 'Price schedule and delivery terms', 'Bid security where the notice asks for it'],
  NG: ['NAFDAC registration for each item', 'Manufacturer’s authorisation', 'GMP certificate and CPP', 'Tax clearance and company registration', 'Bid security where the notice asks for it', 'Samples and certificates of analysis'],
};

export type Stats = { past_awards: number; median_unit: string | null; low_unit: string | null; high_unit: string | null; currency: string | null; buyer_tenders: number; buyer_awarded: number; avg_bidders: string | null; last_award: string | null };

/** Bid, consider or pass: how past awards for these molecules compare with the manufacturer's shelf-based price, how often the
 *  buyer actually awards, and how crowded the field is. Each reason is spelled out. */
export function bidScore(s: Stats | null, myUnit: number | null, mine: boolean, open: boolean) {
  const reasons: string[] = [];
  let score = 0;
  if (!mine) reasons.push('Not one of your molecules.');
  else { score += 2; reasons.push('On a molecule you sell.'); }
  if (s && s.past_awards > 0) {
    reasons.push(`${s.past_awards} past award${s.past_awards === 1 ? '' : 's'} on these molecules here; median ${s.currency ?? ''} ${Number(s.median_unit).toFixed(2)} per unit.`);
    if (myUnit != null && s.median_unit != null) {
      const ratio = myUnit / Number(s.median_unit);
      if (ratio <= 0.9) { score += 2; reasons.push('Your landed price sits below past awards: room to win on price.'); }
      else if (ratio <= 1.1) { score += 1; reasons.push('Your landed price sits at past award levels.'); }
      else reasons.push('Your landed price sits above past awards.');
    }
  } else reasons.push('No past award on these molecules here yet.');
  if (s && s.buyer_tenders > 2) {
    const share = s.buyer_awarded / s.buyer_tenders;
    if (share >= 0.6) { score += 1; reasons.push(`The buyer awards most of what it tenders (${Math.round(share * 100)}%).`); }
    else reasons.push(`The buyer awards only ${Math.round(share * 100)}% of what it tenders.`);
  }
  if (s?.avg_bidders != null) {
    const b = Number(s.avg_bidders);
    if (b <= 3) { score += 1; reasons.push(`Few bidders on past tenders (${b.toFixed(1)} on average).`); }
    else reasons.push(`Crowded: ${b.toFixed(1)} bidders on average.`);
  }
  if (!open) reasons.push('Not open any more: for the record.');
  const verdict = !open ? 'closed' : score >= 4 ? 'bid' : score >= 2 ? 'consider' : 'pass';
  return { verdict, score, reasons };
}

/** A bid price suggestion from past awards: just under the median, never under the floor of past awards. */
export function suggestBid(s: Stats | null) {
  if (!s || s.median_unit == null) return null;
  const med = Number(s.median_unit), low = s.low_unit != null ? Number(s.low_unit) : med * 0.8;
  return { price: Math.max(low, med * 0.95), currency: s.currency ?? '', basis: `5% under the median of ${s.past_awards} past awards, not below their lowest` };
}
