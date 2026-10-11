// Document types the team can upload, per place. Labels are what customers see (internal files are team only).
import { DOSSIER_ITEMS, SHIPMENT_DOCS } from './format';

export const REQUEST_DOC_KINDS: Record<string, string> = {
  assessment: 'Assessment or analysis', dossier: 'Dossier document', shipment: 'Shipment document', quote: 'Quote or proforma',
  contract: 'Contract or agreement', invoice: 'Invoice', other: 'Other document',
  attachment: 'Attachment', requirement_list: 'Requirement list',
};
export const TEAM_REQUEST_KINDS = ['assessment', 'dossier', 'shipment', 'quote', 'contract', 'invoice', 'other'];

export const ENGAGEMENT_DOC_ITEMS: [string, string][] = [
  ['report', 'Report'], ...DOSSIER_ITEMS, ['agreement', 'Agreement or contract'], ['invoice', 'Invoice'],
  ['certificate', 'Registration certificate'], ['regulator', 'Regulator letter or query'], ['other', 'Other document'],
];

export const ACCOUNT_DOC_KINDS: Record<string, string> = {
  agreement: 'Agreement', nda: 'Confidentiality agreement', invoice: 'Invoice', receipt: 'Receipt', licence: 'Licence',
  certificate: 'Certificate', report: 'Report', other: 'Other',
};

export const SUPPLIER_DOC_KINDS: Record<string, string> = {
  gmp: 'GMP certificate', cpp: 'Certificate of Pharmaceutical Product', dmf: 'DMF or CEP', coa: 'Certificate of analysis',
  product_list: 'Product list', price_list: 'Price list', agreement: 'Agreement', licence: 'Manufacturing licence', other: 'Other',
};

/** Label for a request file: its kind, plus the dossier item or shipment document it belongs to. */
export function requestDocLabel(kind: string, item?: string | null) {
  const sub = item ? (DOSSIER_ITEMS.find(([k]) => k === item) ?? SHIPMENT_DOCS.find(([k]) => k === item))?.[1] : null;
  return sub ?? REQUEST_DOC_KINDS[kind] ?? kind;
}

/** Days until a supplier document expires (negative once expired), or null. */
export function daysLeft(d?: string | Date | null) {
  if (!d) return null;
  return Math.floor((new Date(d).getTime() - Date.now()) / 86400e3);
}
