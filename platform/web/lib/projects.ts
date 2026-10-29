// Market entry projects: one per product and market. The stages, what each one usually needs, and the readiness of a
// project from its tasks.

export const PROJECT_STAGES: [string, string][] = [
  ['assess', 'Assess'], ['dossier', 'Dossier'], ['submitted', 'Submitted'], ['approved', 'Approved'], ['distributor', 'Distributor'], ['launched', 'Launched'],
];
export const STAGE_TONE: Record<string, string> = { assess: '', dossier: 'lav', submitted: 'blue', approved: 'mint', distributor: 'peach', launched: 'mint', parked: '' };
export const STAGE_WHAT: Record<string, string> = {
  assess: 'Is this the right product for this market: demand, competition, price, route.',
  dossier: 'The documents the regulator asks for, complete and in the right format.',
  submitted: 'Filed with the regulator; queries answered as they come.',
  approved: 'Registered. The certificate is in hand; renewals start counting.',
  distributor: 'A distributor chosen and signed; price and terms agreed.',
  launched: 'On the shelf. Watch sales, competitors and the renewal date.',
  parked: 'On hold for now.',
};

/** The tasks a stage usually needs; added when a project reaches it, never twice. */
export const STAGE_TASKS: Record<string, string[]> = {
  assess: ['Check demand, competition and the shelf price', 'Confirm the registration route and its cost', 'Decide: go or park'],
  dossier: ['Collect the documents on the checklist', 'Translate labels and leaflets where required', 'Appoint the local representative or distributor who files'],
  submitted: ['Pay the official fees', 'Track regulator queries and answer within the deadline'],
  approved: ['File the certificate and note its expiry', 'Set up renewal and variation reminders'],
  distributor: ['Agree price, territory and exclusivity', 'Sign the agreement and the quality agreement'],
  launched: ['Confirm first shipment and import permit', 'Review sales and competitors after 90 days'],
};

/** Which Nazryx service fits a stage, as a suggested action. */
export const STAGE_SERVICE: Record<string, string | null> = {
  assess: null, dossier: 'dossier_review', submitted: 'market_entry', approved: 'post_registration', distributor: 'partner_intro', launched: 'post_registration', parked: null,
};

export const stageIndex = (s: string) => Math.max(0, PROJECT_STAGES.findIndex(([k]) => k === s));
export const stageLabel = (s: string) => PROJECT_STAGES.find(([k]) => k === s)?.[1] ?? (s === 'parked' ? 'Parked' : s);

/** 0..1: tasks done over tasks, counting the stages already passed as done. */
export function readiness(stage: string, tasks: { done_at: string | Date | null }[]) {
  const passed = stageIndex(stage) / (PROJECT_STAGES.length - 1);
  if (tasks.length === 0) return passed;
  const done = tasks.filter((t) => t.done_at).length / tasks.length;
  return Math.min(1, passed * 0.7 + done * 0.3);
}
