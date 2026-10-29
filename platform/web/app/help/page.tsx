import Link from 'next/link';
import type { ReactNode } from 'react';
import Brand from '@/components/Brand';
import Shell from '@/components/Shell';
import { getUser } from '@/lib/auth';
import { COVERAGE_NOTE } from '@/lib/format';
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP } from '@/lib/support';

export const metadata = { title: 'Help' };

// Questions manufacturers ask. The distributor side is paused (distributor/README.md keeps its help text in git history).
const QA: [string, ReactNode][] = [
  ['Where does the market data come from?', <>From each country&rsquo;s official medicines register: Tanzania, Kenya, Kazakhstan, Kyrgyzstan
    and Uzbekistan, and their national essential medicines lists. We refresh it whenever the regulator publishes. Figures count
    <b> registered products, not sales</b>.</>],
  ['How do my products get in?', <>Upload your catalogue (Excel, CSV, Word or PDF) or search and add them one by one from My products.
    We read the generic name of each product and match it to the market, so French or local spellings are fine.</>],
  ['What does &ldquo;Register these first&rdquo; mean?', <>Your products ranked by opening: on the official list, few or no companies
    registered, and in demand. Each one shows why.</>],
  ['Who are the companies on the Distributors page?', <>The local companies holding registrations in that market. Where the register does
    not name the distributor (Kazakhstan, Kyrgyzstan) it is the company holding the registration. Names stay private: we make the
    introduction.</>],
  ['How do competitor alerts work?', <>Watch a molecule, or all your products, under My products. When a new competitor is registered in one
    of your markets we tell you by email or WhatsApp, and once a week you get a short summary.</>],
  ['What do the plans include?', <>Each plan covers the markets you choose, monthly or yearly. Basic Market Data shows the market; Complete
    Market Access adds distributor matching, pricing and the route to approval; Complete Market Entry is our team doing it with you.
    Add a market at any time from Plan.</>],
  ['Can I talk to someone?', <>Yes. Book a call from Home at a time that suits you, or write to us below.</>],
  ['How do I keep my account safe?', <>Turn on two-step sign-in in Settings. After your password you type a code from an app on your phone.
    After five wrong passwords, sign-in pauses for 15 minutes.</>],
];

export default async function Help({ searchParams }: { searchParams: Promise<{ paused?: string }> }) {
  const sp = await searchParams;
  const u = await getUser();
  const body = (
    <div className="stack" style={{ maxWidth: 760 }}>
      <section className="card stack">
        <h2>Talk to us</h2>
        <p>Email <b>{SUPPORT_EMAIL}</b>{SUPPORT_WHATSAPP && <> or WhatsApp <b>{SUPPORT_WHATSAPP}</b></>}. We will get back to you.</p>
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
  if (u && u.onboarded && (u.account_type === 'manufacturer' || u.role === 'team')) return <Shell user={u} title="Help" sub="How Nazryx works, and how to reach us">{body}</Shell>;
  return (
    <div className="wrap-narrow"><Brand href={u ? '/' : '/signup'} /><h1>Help</h1>{body}
      {!u && <Link className="btn btn-blue" href="/signup" style={{ alignSelf: 'flex-start' }}>Create an account</Link>}</div>
  );
}
