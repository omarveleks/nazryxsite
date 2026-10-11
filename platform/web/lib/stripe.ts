import 'server-only';
import crypto from 'node:crypto';

// Card payments through Stripe, without the SDK: Checkout for new subscriptions, the billing portal for changes and
// cancellation, and signed webhooks. STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET live only in the host's environment.

export const stripeReady = () => Boolean(process.env.STRIPE_SECRET_KEY);

async function call(path: string, params: Record<string, string>) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message ?? 'Payment provider error');
  return j;
}

/** A Checkout page for a monthly subscription to one plan. Returns the URL to send the customer to. */
export async function checkoutUrl(o: { userId: string; email: string; plan: string; planName: string; amountUsd: number; origin: string; customer?: string | null }) {
  const p: Record<string, string> = {
    mode: 'subscription',
    client_reference_id: o.userId,
    'metadata[plan]': o.plan, 'metadata[user_id]': o.userId,
    'subscription_data[metadata][plan]': o.plan, 'subscription_data[metadata][user_id]': o.userId,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(Math.round(o.amountUsd * 100)),
    'line_items[0][price_data][recurring][interval]': 'month',
    'line_items[0][price_data][product_data][name]': `Nazryx ${o.planName}`,
    success_url: `${o.origin}/m/plan?paid=1`,
    cancel_url: `${o.origin}/m/plan?want=${o.plan}`,
    allow_promotion_codes: 'true',
  };
  if (o.customer) p.customer = o.customer; else p.customer_email = o.email;
  return (await call('checkout/sessions', p)).url as string;
}

/** The customer's own billing page: card, invoices, cancel. */
export async function portalUrl(customer: string, origin: string) {
  return (await call('billing_portal/sessions', { customer, return_url: `${origin}/m/plan` })).url as string;
}

/** Check the Stripe-Signature header (HMAC-SHA256 of "timestamp.payload"), allowing 5 minutes of clock skew. */
export function verifyWebhook(payload: string, header: string | null): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((x) => x.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const given = header.split(',').filter((x) => x.startsWith('v1=')).map((x) => x.slice(3));
  return given.some((g) => g.length === expected.length && crypto.timingSafeEqual(Buffer.from(g), Buffer.from(expected)));
}
