// What a team member can open in Admin. The owner (TEAM_OWNER_EMAIL) opens everything and manages the team.
export const TEAM_PERMISSIONS: [string, string, string][] = [
  ['requests', 'Sourcing requests', 'Requests, assessments, quotes, suppliers and shipments'],
  ['manufacturers', 'Manufacturers', 'Manufacturer approvals and engagements'],
  ['accounts', 'Accounts and plans', 'Customer accounts, plans, passwords and account documents'],
  ['claims', 'Company claims', 'Approving distributors who claim a company'],
  ['questions', 'Expert questions', 'Answering customers’ questions'],
  ['documents', 'Documents', 'Supplier documents and every uploaded file'],
  ['data', 'Market data', 'Registry uploads and the review queue'],
  ['regulatory', 'Regulatory library', 'Regulatory documents for every country and the requirements customers see'],
  ['content', 'Content and prices', 'Feed notes, prices, routes and plan prices'],
  ['activity', 'Activity log', 'Who changed what'],
];
export type TeamPermission = 'requests' | 'manufacturers' | 'accounts' | 'claims' | 'questions' | 'documents' | 'data' | 'content' | 'activity' | 'regulatory';

/** Admin tabs and the permission each needs ('team' = owners only). */
export const TAB_PERMISSION: Record<string, TeamPermission | 'team'> = {
  data: 'data', review: 'data', claims: 'claims', requests: 'requests', questions: 'questions', manufacturers: 'manufacturers',
  documents: 'documents', regulatory: 'regulatory', accounts: 'accounts', content: 'content', activity: 'activity', team: 'team',
};

export function teamCan(u: { role: string; team_owner?: boolean; team_permissions?: string[] | null }, perm: TeamPermission | 'team') {
  if (u.role !== 'team') return false;
  if (u.team_owner) return true;
  return perm !== 'team' && (u.team_permissions ?? []).includes(perm);
}
