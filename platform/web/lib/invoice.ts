// The invoice maker's document: one function draws it, for the live preview in Admin and for the copy we keep.
// Output is an A4 page, ready to print or save as PDF from the browser.

export type Line = { text: string; detail?: string; qty: number; unit?: string; price: number; tax?: number; discount?: number };
export type Party = { name: string; company?: string; address?: string; email?: string; phone?: string; taxId?: string };
export type InvoiceData = {
  kind: string;                 // Invoice, Proforma invoice, Quotation, Receipt, Credit note
  number: string;
  issued: string;               // yyyy-mm-dd
  due?: string;
  reference?: string;           // PO or reference
  currency: string;
  from: Party;
  to: Party;
  shipTo?: string;
  lines: Line[];
  discountType: 'none' | 'percent' | 'amount';
  discount: number;
  taxLabel: string;
  taxRate: number;              // applied to lines without their own rate
  shipping: number;
  shippingLabel?: string;
  paid: number;
  notes?: string;
  terms?: string;
  payment?: string;
  signature?: string;
  accent: string;
  layout: 'classic' | 'bold' | 'minimal';
  stamp: '' | 'PAID' | 'DRAFT' | 'COPY';
  logoText?: string;
  decimals: number;
  footer?: string;
};

export const KINDS = ['Invoice', 'Proforma invoice', 'Tax invoice', 'Commercial invoice', 'Quotation', 'Receipt', 'Credit note'];
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'PKR', 'INR', 'CNY', 'KZT', 'UZS', 'KGS', 'KES', 'TZS', 'UGX', 'NGN', 'ZAR', 'RUB', 'TRY', 'CHF'];
export const ACCENTS = ['#0066FF', '#141413', '#0E7C66', '#7A4DFF', '#C2410C', '#0F766E', '#1E3A8A'];

const esc = (s?: string) => (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const br = (s?: string) => esc(s).replace(/\n/g, '<br>');
const day = (s?: string) => {
  if (!s) return '';
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? esc(s) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

export function totals(d: InvoiceData) {
  const rows = d.lines.filter((l) => l.text || l.price).map((l) => {
    const gross = (Number(l.qty) || 0) * (Number(l.price) || 0);
    const net = gross * (1 - (Number(l.discount) || 0) / 100);
    const rate = l.tax === undefined || l.tax === null || Number.isNaN(Number(l.tax)) ? Number(d.taxRate) || 0 : Number(l.tax);
    return { ...l, net, rate };
  });
  const sub = rows.reduce((a, r) => a + r.net, 0);
  const disc = d.discountType === 'percent' ? sub * (Number(d.discount) || 0) / 100 : d.discountType === 'amount' ? Number(d.discount) || 0 : 0;
  const share = sub ? (sub - disc) / sub : 0;                  // the invoice discount lowers each line's taxable amount
  const tax = rows.reduce((a, r) => a + r.net * share * r.rate / 100, 0);
  const total = sub - disc + tax + (Number(d.shipping) || 0);
  return { rows, sub, disc, tax, total, balance: total - (Number(d.paid) || 0) };
}

export function money(n: number, d: InvoiceData) {
  return `${d.currency} ${n.toLocaleString('en-US', { minimumFractionDigits: d.decimals, maximumFractionDigits: d.decimals })}`;
}

function party(p: Party) {
  return [p.company ? `<b>${esc(p.company)}</b>` : '', p.company ? esc(p.name) : `<b>${esc(p.name)}</b>`, br(p.address), esc(p.email), esc(p.phone),
    p.taxId ? `Tax / reg. no. ${esc(p.taxId)}` : ''].filter(Boolean).join('<br>');
}

export function renderInvoice(d: InvoiceData): string {
  const t = totals(d);
  const a = /^#[0-9a-fA-F]{6}$/.test(d.accent) ? d.accent : '#0066FF';
  const bold = d.layout === 'bold', minimal = d.layout === 'minimal';
  const anyDisc = t.rows.some((r) => Number(r.discount)), anyTax = t.rows.some((r) => r.rate);
  const sums: [string, number, boolean?][] = [['Subtotal', t.sub]];
  if (t.disc) sums.push([d.discountType === 'percent' ? `Discount (${d.discount}%)` : 'Discount', -t.disc]);
  if (t.tax) sums.push([d.taxLabel || 'Tax', t.tax]);
  if (Number(d.shipping)) sums.push([d.shippingLabel || 'Shipping', Number(d.shipping)]);
  sums.push(['Total', t.total, true]);
  if (Number(d.paid)) { sums.push(['Paid', -Number(d.paid)]); sums.push(['Balance due', t.balance, true]); }
  const meta = [['Number', esc(d.number)], ['Date', day(d.issued)], d.due ? ['Due', day(d.due)] : null, d.reference ? ['Reference', esc(d.reference)] : null]
    .filter(Boolean) as string[][];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(d.kind)} ${esc(d.number)}</title>
<style>
@page{size:A4;margin:0}
*{box-sizing:border-box}html,body{margin:0;background:#fff}
body{font-family:Inter,Arial,Helvetica,sans-serif;color:#141413;font-size:10pt;line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;padding:18mm 16mm;margin:0 auto;position:relative;display:flex;flex-direction:column}
.band{${bold ? `background:${a};color:#fff;margin:-18mm -16mm 10mm;padding:14mm 16mm 10mm;` : `border-bottom:${minimal ? '1px solid #ECEAE3' : `3px solid ${a}`};padding-bottom:8mm;margin-bottom:8mm;`}display:flex;justify-content:space-between;gap:10mm}
.logo{font-weight:800;font-size:18pt;color:${bold ? '#fff' : a};letter-spacing:-.02em}
h1{font-size:${minimal ? 18 : 24}pt;margin:0;font-weight:700;text-align:right;color:${bold ? '#fff' : '#141413'}}
.meta{text-align:right;margin-top:3mm;font-size:9.5pt}.meta td{padding:0 0 0 6mm}.meta td:first-child{color:${bold ? 'rgba(255,255,255,.75)' : '#5E5E58'}}
.parties{display:grid;grid-template-columns:repeat(${d.shipTo ? 3 : 2},1fr);gap:8mm;margin-bottom:8mm}
.lbl{font-size:8pt;text-transform:uppercase;letter-spacing:.06em;color:#5E5E58;margin-bottom:1.5mm}
table.items{width:100%;border-collapse:collapse}
.items th{font-size:8pt;text-transform:uppercase;letter-spacing:.05em;text-align:left;padding:2.5mm 2mm;${minimal ? 'border-bottom:1px solid #141413' : `background:${a}14;color:#141413`}}
.items td{padding:2.5mm 2mm;border-bottom:1px solid #ECEAE3;vertical-align:top}.r{text-align:right;white-space:nowrap}
.detail{color:#5E5E58;font-size:8.5pt}
.sums{margin-left:auto;width:78mm;margin-top:4mm;border-collapse:collapse}.sums td{padding:1.6mm 2mm}
.sums tr.big td{font-weight:700;font-size:11.5pt;border-top:1.5px solid #141413}
.sums tr.big:last-child td{${minimal ? '' : `color:${a}`}}
.box{background:#F7F6F2;border-radius:3mm;padding:4mm 5mm;margin-top:6mm;break-inside:avoid}
.foot{margin-top:auto;padding-top:8mm;color:#5E5E58;font-size:8.5pt;display:flex;justify-content:space-between;gap:8mm;align-items:flex-end}
.sign{border-top:1px solid #141413;padding-top:1.5mm;width:60mm;text-align:center;color:#141413}
.stamp{position:absolute;top:70mm;right:22mm;transform:rotate(-14deg);border:3px solid ${d.stamp === 'PAID' ? '#0E7C66' : '#C2410C'};color:${d.stamp === 'PAID' ? '#0E7C66' : '#C2410C'};
  font-weight:800;font-size:26pt;padding:1mm 6mm;border-radius:2mm;opacity:.75;letter-spacing:.08em}
@media screen{body{background:#ECEAE3}.page{box-shadow:none;margin:0 auto;background:#fff}}
</style></head><body><div class="page">
${d.stamp ? `<div class="stamp">${esc(d.stamp)}</div>` : ''}
<div class="band"><div><div class="logo">${esc(d.logoText || d.from.company || d.from.name)}</div></div>
<div><h1>${esc(d.kind)}</h1><table class="meta">${meta.map(([k, v]) => `<tr><td>${k}</td><td><b>${v}</b></td></tr>`).join('')}</table></div></div>
<div class="parties"><div><div class="lbl">From</div>${party(d.from)}</div><div><div class="lbl">${d.kind === 'Quotation' ? 'For' : 'Bill to'}</div>${party(d.to)}</div>
${d.shipTo ? `<div><div class="lbl">Ship to</div>${br(d.shipTo)}</div>` : ''}</div>
<table class="items"><thead><tr><th style="width:46%">Description</th><th class="r">Qty</th><th class="r">Unit price</th>${anyDisc ? '<th class="r">Disc.</th>' : ''}${anyTax ? `<th class="r">${esc(d.taxLabel || 'Tax')}</th>` : ''}<th class="r">Amount</th></tr></thead>
<tbody>${t.rows.map((r) => `<tr><td>${esc(r.text)}${r.detail ? `<div class="detail">${br(r.detail)}</div>` : ''}</td>
<td class="r">${Number(r.qty).toLocaleString('en-US')}${r.unit ? ` ${esc(r.unit)}` : ''}</td><td class="r">${money(Number(r.price) || 0, d)}</td>
${anyDisc ? `<td class="r">${Number(r.discount) ? `${r.discount}%` : ''}</td>` : ''}${anyTax ? `<td class="r">${r.rate ? `${r.rate}%` : ''}</td>` : ''}<td class="r">${money(r.net, d)}</td></tr>`).join('')}</tbody></table>
<table class="sums">${sums.map(([k, v, big]) => `<tr class="${big ? 'big' : ''}"><td>${k}</td><td class="r">${money(v, d)}</td></tr>`).join('')}</table>
${d.payment ? `<div class="box"><div class="lbl">How to pay</div>${br(d.payment)}${d.number ? `<div class="detail" style="margin-top:1.5mm">Please quote ${esc(d.number)}.</div>` : ''}</div>` : ''}
${d.notes ? `<div style="margin-top:6mm"><div class="lbl">Notes</div>${br(d.notes)}</div>` : ''}
${d.terms ? `<div style="margin-top:5mm"><div class="lbl">Terms</div><div class="detail">${br(d.terms)}</div></div>` : ''}
<div class="foot"><div>${br(d.footer)}</div>${d.signature ? `<div class="sign">${esc(d.signature)}</div>` : ''}</div>
</div></body></html>`;
}
