/** Registrations per certificate year: one series, brand blue, rounded data-ends, hover titles, table view. */
export default function YearChart({ data }: { data: { year: number; n: number }[] }) {
  if (data.length === 0) return null;
  const W = 640, H = 200, padL = 36, padB = 24, padT = 12;
  const max = Math.max(...data.map((d) => d.n));
  const step = Math.ceil(max / 4 / 50) * 50 || 1;
  const top = step * 4;
  const bw = (W - padL) / data.length;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Registered products by year of certificate" style={{ width: '100%', height: 'auto', display: 'block' }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={padL} x2={W} y1={y(i * step)} y2={y(i * step)} stroke="#ECEAE3" strokeWidth="1" />
            <text x={padL - 6} y={y(i * step) + 4} textAnchor="end" fontSize="10" fill="#5E5E58">{i * step}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * bw + 1, w = Math.max(2, bw - 2), h = y(0) - y(d.n);
          return (
            <g key={d.year}>
              <rect x={x - 1} y={padT} width={bw} height={H - padT - padB} fill="transparent"><title>{`${d.year}: ${d.n} products`}</title></rect>
              <path d={`M${x},${y(0)} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${Math.max(0, w - 8)} q4,0 4,4 v${Math.max(0, h - 4)} z`} fill="#0066FF" pointerEvents="none" />
              {(i % 3 === 0 || i === data.length - 1) && <text x={x + w / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="#5E5E58">{d.year}</text>}
            </g>
          );
        })}
      </svg>
      <details style={{ marginTop: 8 }}><summary className="note" style={{ cursor: 'pointer' }}>Show as table</summary>
        <table className="tbl small"><thead><tr><th>Year</th><th className="r">Products</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.year}><td>{d.year}</td><td className="r num">{d.n}</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}
