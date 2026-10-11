'use client';
/** Opens the browser's print dialog, where "Save as PDF" gives the customer a file. */
export default function PrintButton({ label = 'Download as PDF' }: { label?: string }) {
  return <button type="button" className="btn btn-blue btn-sm no-print" onClick={() => window.print()}>{label}</button>;
}
