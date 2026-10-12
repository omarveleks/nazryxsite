import { pool } from '@/lib/db';
import { verifyWebhook } from '@/lib/stripe';

// Stripe tells us about payments here. Each event is checked against its signature, then recorded once; the worker
// applies it (plan on or off, invoice issued). Nothing here trusts the request body without the signature.
export async function POST(req: Request) {
  const payload = await req.text();
  if (!verifyWebhook(payload, req.headers.get('stripe-signature'))) return new Response('Bad signature', { status: 400 });
  const ev = JSON.parse(payload);
  const o = ev.data?.object ?? {};
  const meta = o.metadata ?? o.subscription_details?.metadata ?? o.lines?.data?.[0]?.metadata ?? {};
  const plan = ['data', 'access', 'market'].includes(meta.plan) ? meta.plan : null;
  const markets = String(meta.markets ?? '').split(',').filter((c: string) => /^[A-Z]{2}$/.test(c));
  const interval = meta.interval === 'year' ? 'year' : 'month';
  let row: (string | number | null)[] | null = null;
  if (ev.type === 'checkout.session.completed' && o.mode === 'subscription' && plan) {
    row = ['checkout_completed', o.client_reference_id ?? meta.user_id ?? null, plan, o.amount_total ?? null, o.currency ?? 'usd', o.customer, o.subscription];
  } else if (ev.type === 'invoice.paid') {
    row = ['invoice_paid', meta.user_id ?? null, plan, o.amount_paid ?? null, o.currency ?? 'usd', o.customer, o.subscription ?? o.parent?.subscription_details?.subscription ?? null];
  } else if (ev.type === 'customer.subscription.deleted') {
    row = ['subscription_ended', meta.user_id ?? null, plan, null, 'usd', o.customer, o.id];
  }
  if (row) {
    await pool.query(`insert into payment_events (stripe_event_id, kind, user_id, plan, amount_cents, currency, stripe_customer, stripe_subscription,
                      markets, billing_interval) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (stripe_event_id) do nothing`,
      [ev.id, ...row, markets.length ? markets : null, interval]);
    await pool.query("select pg_notify('ingest', 'payment')");
  }
  return Response.json({ received: true });
}
