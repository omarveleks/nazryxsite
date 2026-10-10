'use server';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { one, withUser } from '@/lib/db';
import { back, int, str } from '@/lib/forms';
import { domainMatches, saveUpload } from '@/lib/uploads';

export async function completeOnboarding(f: FormData) {
  const u = await requireUser({ allowOnboarding: true });
  const companyId = int(f, 'company_id');
  const manualName = str(f, 'company_name', 200);
  const source = str(f, 'portfolio_source', 20) as 'registry' | 'catalogue' | 'scratch';
  if (!companyId && !manualName) back('/onboarding', { error: 'Pick your company from the list, or type its name.' });
  if (!['registry', 'catalogue', 'scratch'].includes(source)) back('/onboarding', { error: 'Choose how to add your portfolio.' });
  if (source === 'registry' && !companyId) back('/onboarding', { error: 'The registered list needs a company from the list.' });
  let licence, catalogue;
  try {
    licence = await saveUpload(f.get('licence'), u.id);
    catalogue = await saveUpload(f.get('catalogue'), u.id);
  } catch (e) {
    back('/onboarding', { error: (e as Error).message });
  }
  if (!licence) back('/onboarding', { error: 'Upload your licence so we can verify the claim.' });
  if (source === 'catalogue' && !catalogue) back('/onboarding', { error: 'Attach your catalogue, or pick another option.' });
  await withUser(u.id, async (db) => {
    const company = companyId ? await one(db, 'select id, cluster_key, display_name, claimed_by, verified from companies where id = $1', [companyId]) : null;
    if (companyId && !company) back('/onboarding', { error: 'Company not found.' });
    const key = company?.cluster_key ?? manualName.toLowerCase();
    await db.query(`insert into company_claims (user_id, company_id, company_name, email_domain, domain_match, licence_path,
                      licence_name, portfolio_source, catalogue_path, catalogue_name)
                    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [u.id, company?.id ?? null, company ? null : manualName, u.email.split('@')[1], domainMatches(u.email, key),
       licence!.path, licence!.name, source, catalogue?.path ?? null, catalogue?.name ?? null]);
    await db.query(`update users set onboarded = true where id = $1`, [u.id]);
    await db.query(`insert into notifications (user_id, channel, subject, body) values (null, 'email', 'New company claim', $1)`,
      [`${u.email} claims ${company?.display_name ?? manualName}. Review it on the admin page.`]);
  });
  redirect(source === 'scratch' ? '/search?welcome=1' : '/home?welcome=1');
}

export async function skipOnboarding() {
  const u = await requireUser({ allowOnboarding: true });
  await withUser(u.id, (db) => db.query('update users set onboarded = true where id = $1', [u.id]));
  redirect('/search?welcome=1');
}
