'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ACCENTS, CURRENCIES, KINDS, money, renderInvoice, totals, type InvoiceData, type Line, type Party } from '@/lib/invoice';
import { saveMadeInvoice } from '@/app/actions/admin';

const STORE = 'nzx-invoice-draft';

function F({ label, children, w }: { label: string; children: React.ReactNode; w?: number }) {
  return <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: w ? `0 0 ${w}px` : '1 1 140px', minWidth: 0 }}>{label}{children}</label>;
}

/** The A4 page shrunk to the width it is given. */
function Preview({ html, frame }: { html: string; frame: React.RefObject<HTMLIFrameElement | null> }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.5);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setK(el.clientWidth / 794));     // 210 mm at 96 dpi
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div ref={wrap} className="a4-wrap"><iframe ref={frame} title="Invoice preview" srcDoc={html} className="a4" style={{ transform: `scale(${k})` }} /></div>;
}

export default function InvoiceMaker({ start, people }: { start: InvoiceData; people: Party[] }) {
  const [d, setD] = useState<InvoiceData>(() => {
    try { const s = localStorage.getItem(STORE); if (s && !start.to.name) return { ...start, ...JSON.parse(s) }; } catch { /* no storage */ }
    return start;
  });
  const [status, setStatus] = useState<'due' | 'paid'>('due');
  const [file, setFile] = useState(true);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => renderInvoice({ ...d, number: d.number || 'Next number' }), [d]);
  const t = totals(d);
  const set = (patch: Partial<InvoiceData>) => setD((x) => {
    const n = { ...x, ...patch };
    try { localStorage.setItem(STORE, JSON.stringify(n)); } catch { /* fine */ }
    return n;
  });
  const setP = (who: 'from' | 'to', patch: Partial<Party>) => set({ [who]: { ...d[who], ...patch } } as Partial<InvoiceData>);
  const setL = (i: number, patch: Partial<Line>) => set({ lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const num = (v: string) => (v === '' ? 0 : Number(v));
  const pick = (v: string) => {
    const p = people.find((x) => `${x.company || x.name} · ${x.email || ''}` === v);
    if (p) set({ to: { name: p.name ?? '', company: p.company ?? '', address: p.address ?? '', email: p.email ?? '', phone: p.phone ?? '', taxId: p.taxId ?? '' } });
  };
  const print = () => frame.current?.contentWindow?.print();
  const save = async () => {
    setBusy(true); setMsg({});
    const r = await saveMadeInvoice(d, { file, status });
    setBusy(false);
    if (r.error) return setMsg({ err: r.error });
    set({ number: r.number! });
    setMsg({ ok: `Saved as ${r.number}. Print or save it as PDF, or find it in Billing.` });
  };
  const reset = () => { try { localStorage.removeItem(STORE); } catch { /* fine */ } setD(start); setMsg({}); };

  const party = (who: 'from' | 'to') => (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <F label="Company"><input className="input" value={d[who].company ?? ''} onChange={(e) => setP(who, { company: e.target.value })} /></F>
        <F label={who === 'to' ? 'Contact name' : 'Name'}><input className="input" value={d[who].name} onChange={(e) => setP(who, { name: e.target.value })} /></F>
      </div>
      <F label="Address"><textarea className="input" rows={2} value={d[who].address ?? ''} onChange={(e) => setP(who, { address: e.target.value })} /></F>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <F label="Email"><input className="input" type="email" value={d[who].email ?? ''} onChange={(e) => setP(who, { email: e.target.value })} /></F>
        <F label="Phone"><input className="input" value={d[who].phone ?? ''} onChange={(e) => setP(who, { phone: e.target.value })} /></F>
        <F label="Tax / reg. no."><input className="input" value={d[who].taxId ?? ''} onChange={(e) => setP(who, { taxId: e.target.value })} /></F>
      </div>
    </div>);

  return (
    <div className="maker">
      <div className="stack">
        <section className="card stack">
          <h2>Document</h2>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <F label="Type"><select className="input" value={d.kind} onChange={(e) => set({ kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></F>
            <F label="Number"><input className="input" value={d.number} placeholder="Next number" onChange={(e) => set({ number: e.target.value })} /></F>
            <F label="Reference / PO"><input className="input" value={d.reference ?? ''} onChange={(e) => set({ reference: e.target.value })} /></F>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <F label="Date"><input className="input" type="date" value={d.issued} onChange={(e) => set({ issued: e.target.value })} /></F>
            <F label="Due"><input className="input" type="date" value={d.due ?? ''} onChange={(e) => set({ due: e.target.value })} /></F>
            <F label="Currency"><select className="input" value={d.currency} onChange={(e) => set({ currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></F>
            <F label="Decimals" w={90}><select className="input" value={d.decimals} onChange={(e) => set({ decimals: Number(e.target.value) })}><option value={2}>2</option><option value={0}>0</option><option value={3}>3</option></select></F>
          </div>
        </section>
        <section className="card stack">
          <h2>Bill to</h2>
          <F label="Pick someone we invoiced or a portal account (optional)">
            <input className="input" list="people" placeholder="Start typing a name or email" onChange={(e) => pick(e.target.value)} />
            <datalist id="people">{people.map((p, i) => <option key={i} value={`${p.company || p.name} · ${p.email || ''}`} />)}</datalist></F>
          {party('to')}
          <F label="Ship to (optional)"><textarea className="input" rows={2} value={d.shipTo ?? ''} onChange={(e) => set({ shipTo: e.target.value })} /></F>
        </section>
        <section className="card stack">
          <h2>Items</h2>
          {d.lines.map((l, i) => (
            <div key={i} className="stack" style={{ gap: 6, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <F label={`Item ${i + 1}`}><input className="input" value={l.text} onChange={(e) => setL(i, { text: e.target.value })} /></F>
                <F label="Qty" w={70}><input className="input" type="number" step="any" value={l.qty} onChange={(e) => setL(i, { qty: num(e.target.value) })} /></F>
                <F label="Unit" w={80}><input className="input" value={l.unit ?? ''} placeholder="pcs" onChange={(e) => setL(i, { unit: e.target.value })} /></F>
                <F label="Price" w={110}><input className="input" type="number" step="any" value={l.price} onChange={(e) => setL(i, { price: num(e.target.value) })} /></F>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <F label="Details (optional)"><input className="input" value={l.detail ?? ''} onChange={(e) => setL(i, { detail: e.target.value })} /></F>
                <F label="Disc. %" w={80}><input className="input" type="number" step="any" value={l.discount ?? ''} onChange={(e) => setL(i, { discount: e.target.value === '' ? undefined : num(e.target.value) })} /></F>
                <F label="Tax %" w={80}><input className="input" type="number" step="any" value={l.tax ?? ''} placeholder={String(d.taxRate)} onChange={(e) => setL(i, { tax: e.target.value === '' ? undefined : num(e.target.value) })} /></F>
                <span className="small num" style={{ flex: '0 0 auto', paddingBottom: 10 }}>{money(t.rows[i]?.net ?? 0, d)}</span>
                <div className="row" style={{ gap: 4 }}>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label="Move up" disabled={!i} onClick={() => { const x = [...d.lines]; [x[i - 1], x[i]] = [x[i], x[i - 1]]; set({ lines: x }); }}>↑</button>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label="Remove line" disabled={d.lines.length < 2} onClick={() => set({ lines: d.lines.filter((_, j) => j !== i) })}>✕</button>
                </div>
              </div>
            </div>))}
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => set({ lines: [...d.lines, { text: '', qty: 1, price: 0 }] })}>+ Add line</button>
        </section>
        <section className="card stack">
          <h2>Totals</h2>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <F label="Discount"><select className="input" value={d.discountType} onChange={(e) => set({ discountType: e.target.value as InvoiceData['discountType'] })}>
              <option value="none">None</option><option value="percent">Percent</option><option value="amount">Amount</option></select></F>
            {d.discountType !== 'none' && <F label={d.discountType === 'percent' ? 'Discount %' : 'Discount amount'}><input className="input" type="number" step="any" value={d.discount} onChange={(e) => set({ discount: num(e.target.value) })} /></F>}
            <F label="Tax name"><input className="input" value={d.taxLabel} onChange={(e) => set({ taxLabel: e.target.value })} /></F>
            <F label="Tax % (all lines)"><input className="input" type="number" step="any" value={d.taxRate} onChange={(e) => set({ taxRate: num(e.target.value) })} /></F>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <F label="Extra charge name"><input className="input" value={d.shippingLabel ?? ''} onChange={(e) => set({ shippingLabel: e.target.value })} /></F>
            <F label="Extra charge"><input className="input" type="number" step="any" value={d.shipping} onChange={(e) => set({ shipping: num(e.target.value) })} /></F>
            <F label="Already paid"><input className="input" type="number" step="any" value={d.paid} onChange={(e) => set({ paid: num(e.target.value) })} /></F>
          </div>
          <p className="small">Subtotal {money(t.sub, d)} · Total <b>{money(t.total, d)}</b>{d.paid ? <> · Balance <b>{money(t.balance, d)}</b></> : null}</p>
        </section>
        <section className="card stack">
          <h2>Text</h2>
          <F label="How to pay"><textarea className="input" rows={3} value={d.payment ?? ''} onChange={(e) => set({ payment: e.target.value })} /></F>
          <F label="Notes"><textarea className="input" rows={2} value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></F>
          <F label="Terms"><textarea className="input" rows={2} value={d.terms ?? ''} onChange={(e) => set({ terms: e.target.value })} /></F>
          <F label="Footer"><input className="input" value={d.footer ?? ''} onChange={(e) => set({ footer: e.target.value })} /></F>
          <F label="Signed by (optional)"><input className="input" value={d.signature ?? ''} onChange={(e) => set({ signature: e.target.value })} /></F>
        </section>
        <section className="card stack">
          <h2>From</h2>
          {party('from')}
        </section>
        <section className="card stack">
          <h2>Look</h2>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <F label="Layout"><select className="input" value={d.layout} onChange={(e) => set({ layout: e.target.value as InvoiceData['layout'] })}>
              <option value="classic">Classic</option><option value="bold">Bold header</option><option value="minimal">Minimal</option></select></F>
            <label className="row small" style={{ gap: 6, alignSelf: 'flex-end', paddingBottom: 10 }}><input type="checkbox" checked={d.logo !== false} onChange={(e) => set({ logo: e.target.checked })} /> Nazryx logo</label>
            <F label="Name at the top"><input className="input" value={d.logoText ?? ''} onChange={(e) => set({ logoText: e.target.value })} /></F>
            <F label="Stamp"><select className="input" value={d.stamp} onChange={(e) => set({ stamp: e.target.value as InvoiceData['stamp'] })}>
              <option value="">None</option><option>PAID</option><option>DRAFT</option><option>COPY</option></select></F>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="small">Colour</span>
            {ACCENTS.map((c) => <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => set({ accent: c })}
              style={{ width: 28, height: 28, borderRadius: 8, background: c, border: d.accent === c ? '3px solid var(--ink)' : '1px solid var(--line)', cursor: 'pointer' }} />)}
            <input type="color" aria-label="Any colour" value={d.accent} onChange={(e) => set({ accent: e.target.value })} />
          </div>
        </section>
      </div>
      <div className="maker-preview">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn btn-blue" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          <button type="button" className="btn btn-ghost" onClick={print}>Print or save as PDF (A4)</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>Start over</button>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={status === 'paid'} onChange={(e) => setStatus(e.target.checked ? 'paid' : 'due')} /> Paid</label>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={file} onChange={(e) => setFile(e.target.checked)} /> If they have a portal account, put it in their documents</label>
        </div>
        {msg.ok && <div className="ok" role="status">{msg.ok}</div>}
        {msg.err && <div className="err" role="alert">{msg.err}</div>}
        <Preview html={html} frame={frame} />
      </div>
    </div>
  );
}
