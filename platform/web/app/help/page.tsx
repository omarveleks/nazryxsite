import Link from 'next/link';
import Brand from '@/components/Brand';
import Shell from '@/components/Shell';
import { getUser } from '@/lib/auth';
import { COVERAGE_NOTE } from '@/lib/format';
import { langOf, setLang } from '@/lib/i18n';
import { cookieLang } from '@/lib/i18n-server';
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP } from '@/lib/support';

export const metadata = { title: 'Help' };

// Questions manufacturers and distributors ask, in the reader's language.
const QA: [string, string][] = [
  ['Where does the market data come from?', 'From each country’s official medicines register and its national essential medicines list: Tanzania, Kenya, Nigeria, Kazakhstan, Kyrgyzstan, Uzbekistan, Senegal and Cameroon, with Côte d’Ivoire from its essential list until its regulator publishes a register. We refresh it whenever the regulator publishes. Figures count registered products, not sales. Every number says where it came from and how sure it is.'],
  ['How do my products get in?', 'Upload your catalogue (Excel, CSV, Word or PDF) or search and add them one by one from My products. We read the generic name of each product and match it to the market, so French, Russian or local spellings are fine.'],
  ['What does “Register these first” mean?', 'Your products ranked by opening: on the official list, few or no companies registered, and in demand. Each one shows why.'],
  ['Who are the companies on the Partners page?', 'The local companies holding registrations in that market. Where the register does not name the distributor (Kazakhstan, Kyrgyzstan) it is the company holding the registration. Names show on the Access plan; we make the introduction.'],
  ['What is a project?', 'One product in one market, from assessment to the shelf. Each stage comes with its usual tasks and the documents the market asks for; you tick them off, share a read-only link with the person who signs, and book a Nazryx service onto a stage when you want it done for you.'],
  ['How do alerts and the inbox work?', 'Watch a molecule, or all your products, under My products. New competitors, tenders, price moves, requirements and deadlines land in your inbox and, if you like, by email or WhatsApp. Once a week you get a short summary; once a month, what you got out of Nazryx.'],
  ['What do the plans include?', 'Each plan covers the markets you choose, monthly or yearly, with a 14-day trial on one market. Basic Market Data shows the market; Complete Market Access adds distributor names, matching, pricing and the route to approval; Complete Market Entry is our team doing it with you. Add a market at any time from Plan.'],
  ['Can my colleagues use my account?', 'Yes. Add seats from Settings with a role: regulatory and sales seats work on projects and comments, viewers read. Mention a colleague with @ in any note and it lands in their inbox.'],
  ['Can I talk to someone?', 'Yes. Book a call from Home at a time that suits you, ask a question under Ask Nazryx, or write to us below.'],
  ['How do I keep my account safe?', 'Turn on two-step sign-in in Settings. After your password you type a code from an app on your phone. You can also sign in with a one-time link sent to your email. After five wrong passwords, sign-in pauses for 15 minutes.'],
];

export default async function Help() {
  const u = await getUser();
  const t = setLang(u ? langOf(u) : await cookieLang());
  const body = (
    <div className="stack" style={{ maxWidth: 760 }}>
      <section className="card stack">
        <h2>{t('Talk to us')}</h2>
        <p>{t('Email')} <b>{SUPPORT_EMAIL}</b>{SUPPORT_WHATSAPP && <> {t('or WhatsApp')} <b>{SUPPORT_WHATSAPP}</b></>}. {t('We will get back to you.')}</p>
      </section>
      {QA.map(([q, a]) => (
        <section key={q} className="card stack" style={{ gap: 8 }}>
          <h3 style={{ fontSize: 17 }}>{t(q)}</h3>
          <p className="muted">{t(a)}</p>
        </section>
      ))}
      <p className="note">{t(COVERAGE_NOTE)}</p>
    </div>
  );
  if (u && u.onboarded && u.role !== 'team' || u?.role === 'team') return <Shell user={u!} title={t('Help')} sub={t('How Nazryx works, and how to reach us')}>{body}</Shell>;
  return (
    <main className="wrap-narrow" id="main"><Brand href={u ? '/' : '/signup'} /><h1>{t('Help')}</h1>{body}
      {!u && <Link className="btn btn-blue" href="/signup" style={{ alignSelf: 'flex-start' }}>{t('Create an account')}</Link>}</main>
  );
}
