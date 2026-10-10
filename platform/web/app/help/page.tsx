import Link from 'next/link';
import type { ReactNode } from 'react';
import Brand from '@/components/Brand';
import Shell from '@/components/Shell';
import { getUser } from '@/lib/auth';
import { COVERAGE_NOTE, FREE, OFFICIAL_LIST } from '@/lib/format';
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP } from '@/lib/support';

export const metadata = { title: 'Help' };

const QA: [string, ReactNode][] = [
  ['Where does the data come from?', <>Public registration data for medicines in Tanzania, updated every two days, and the {OFFICIAL_LIST()}.
    Company and competitor figures show <b>registered coverage, not sales</b>.</>],
  ['What is the gap score?', <>A score out of 100 for how open a molecule is: high demand (on the official list, used widely),
    few registered competitors, and whether Nazryx can source it. 100 means wide demand, nobody registered and supply ready.</>],
  ['How do enrich credits work?', <>The free plan has {FREE.credits} credits a month. Opening a molecule&apos;s full page costs one credit,
    once; opening it again is free. Credits reset at the start of each month. The paid plan has no credit limit.</>],
  ['What do I get on the paid plan?', <>Price bands, supplier availability, the full ranked list of gaps, more countries as they launch,
    alerts on every new registration by companies you follow, team seats, and no limit on active requests
    (free: {FREE.requests}). Upgrade from Settings and our team will contact you.</>],
  ['Why do I need to claim my company?', <>So we know you are who you say you are. We check your licence and your work email by hand,
    then unlock your company profile and can pre-fill your portfolio from your registrations.</>],
  ['How do sourcing requests work?', <>Tell us the molecule, quantity and target price. Our team reaches out, finds suppliers and posts
    quotes. Quotes are anonymous until you accept one: accepting reveals the supplier and the price, and opens an order. You see each
    stage on the Requests page, and updates arrive by email or WhatsApp.</>],
  ['Who can see my portfolio and requests?', <>Only you, teammates on your account, and the Nazryx team. Other companies never see them.
    Supplier details stay private to the Nazryx team until you accept a quote.</>],
  ['How do I keep my account safe?', <>Turn on two-step sign-in in Settings. After your password you type a code from an app on your phone.
    After five wrong passwords, sign-in pauses for 15 minutes.</>],
];

export default async function Help() {
  const u = await getUser();
  const body = (
    <div className="stack" style={{ maxWidth: 760 }}>
      <section className="card stack">
        <h2>Talk to us</h2>
        <p>Email <b>{SUPPORT_EMAIL}</b>{SUPPORT_WHATSAPP && <> or WhatsApp <b>{SUPPORT_WHATSAPP}</b></>}. We will get back to you.</p>
        {u && <p className="note">For a sourcing question, message us inside the request so everything stays in one place.</p>}
      </section>
      {QA.map(([q, a]) => (
        <section key={q} className="card stack" style={{ gap: 8 }}>
          <h3 style={{ fontSize: 17 }}>{q}</h3>
          <p className="muted">{a}</p>
        </section>
      ))}
      <p className="note">{COVERAGE_NOTE}</p>
    </div>
  );
  if (u && u.onboarded) return <Shell user={u} title="Help" sub="How Nazryx works, and how to reach us">{body}</Shell>;
  return (
    <div className="wrap-narrow"><Brand href={u ? '/home' : '/signup'} /><h1>Help</h1>{body}
      {!u && <Link className="btn btn-blue" href="/signup" style={{ alignSelf: 'flex-start' }}>Create a free account</Link>}</div>
  );
}
