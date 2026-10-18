import Shell from '@/components/Shell';
import { requireTeam } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import type { InvoiceData } from '@/lib/invoice';
import InvoiceMaker from './InvoiceMaker';

export const metadata = { title: 'Invoice maker' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const u = await requireTeam('accounts');
  const sp = await searchParams;
  const d = await withUser(u.id, async (db) => ({
    st: await one(db, 'select * from invoice_settings where id = 1'),
    copy: sp.from ? await one(db, 'select data from invoices where number = $1 and data is not null', [sp.from]) : null,
    // people we invoiced before, to pick again
    past: await rows(db, `select distinct on (lower(coalesce(data->'to'->>'company', data->'to'->>'name'))) data->'to' as to
                          from invoices where data is not null order by lower(coalesce(data->'to'->>'company', data->'to'->>'name')), issued_at desc limit 200`),
    accounts: await rows(db, `select u.email, coalesce(p.company_name, u.name, u.email) as company, u.name, p.hq_country
                              from users u left join manufacturer_profiles p on p.user_id = u.id where u.role <> 'team' order by 2 limit 500`),
  }));
  const st = d.st ?? {};
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + (st.terms_days ?? 14) * 864e5).toISOString().slice(0, 10);
  const base: InvoiceData = {
    kind: 'Invoice', number: '', issued: today, due, reference: '', currency: 'USD',
    from: { name: st.issuer ?? 'Nazryx', company: '', address: st.address ?? '', email: st.email ?? '', phone: st.phone ?? '', taxId: st.tax_id ?? '' },
    to: { name: '', company: '', address: '', email: '', phone: '', taxId: '' }, shipTo: '',
    lines: [{ text: '', detail: '', qty: 1, unit: '', price: 0 }],
    discountType: 'none', discount: 0, taxLabel: 'VAT', taxRate: 0, shipping: 0, shippingLabel: 'Shipping', paid: 0,
    notes: '', terms: '', payment: st.payment_details ?? '', signature: '', accent: '#0066FF', layout: 'classic', stamp: '',
    logoText: 'Nazryx', logo: true, decimals: 2, footer: st.footer ?? '',
  };
  const start = d.copy?.data ? { ...d.copy.data, number: '', issued: today, due, stamp: '' } : base;
  const people = [
    ...d.past.map((p: any) => p.to),
    ...d.accounts.map((a: any) => ({ name: a.name ?? '', company: a.company, email: a.email, address: a.hq_country ?? '', phone: '', taxId: '' })),
  ];
  return (
    <Shell user={u} title="Invoice maker" sub="For any customer, in the portal or not. A4, ready to print or save as PDF.">
      <InvoiceMaker start={start} people={people} />
    </Shell>
  );
}
