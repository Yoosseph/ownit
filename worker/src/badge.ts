// A shields.io-style flat badge, rendered without external services.

const NARROW = new Set("iljI.,:;'!|() ");
const WIDE = new Set('mwMW%@');

/** Rough Verdana 11px text width, close enough to size the badge. */
export function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += NARROW.has(ch) ? 3.8 : WIDE.has(ch) ? 10.2 : /[A-Z0-9]/.test(ch) ? 7.5 : 6.6;
  return Math.ceil(width);
}

export function badgeColor(pct: number | null): string {
  if (pct === null) return '#9f9f9f';
  if (pct >= 90) return '#4c1';
  if (pct >= 75) return '#97ca00';
  if (pct >= 60) return '#a4a61d';
  if (pct >= 40) return '#dfb317';
  if (pct >= 20) return '#fe7d37';
  return '#e05d44';
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function badgeSvg(label: string, message: string, color: string): string {
  const lw = textWidth(label) + 10;
  const mw = textWidth(message) + 10;
  const w = lw + mw;
  const l = escapeXml(label);
  const m = escapeXml(message);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${l}: ${m}">
<title>${l}: ${m}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${mw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${l}</text><text x="${lw / 2}" y="14">${l}</text>
<text x="${lw + mw / 2}" y="15" fill="#010101" fill-opacity=".3">${m}</text><text x="${lw + mw / 2}" y="14">${m}</text>
</g>
</svg>`;
}

export function badgeMessage(verifiedPct: number | null, tracked: boolean): string {
  if (!tracked) return 'not tracked';
  return verifiedPct === null ? 'no pushes yet' : `${verifiedPct}% verified`;
}
