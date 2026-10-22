// A shields.io-style flat badge, rendered without external services.
import type { Stats } from './stats';

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

const LABEL_COLOR = '#555';
const MUTED_COLOR = '#9f9f9f';

export interface BadgeSegment {
  text: string;
  color: string;
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A badge of side-by-side segments, e.g. [Ownit][Verified 55%][Unverified 45%]. */
export function badgeSvg(segments: BadgeSegment[]): string {
  const widths = segments.map((s) => textWidth(s.text) + 10);
  const total = widths.reduce((sum, w) => sum + w, 0);
  const starts = widths.map((_, i) => widths.slice(0, i).reduce((sum, w) => sum + w, 0));
  const texts = segments.map((s) => escapeXml(s.text));
  const [label = '', ...rest] = texts;
  const title = rest.length ? `${label}: ${rest.join(' | ')}` : label;
  const rects = segments.map((s, i) => `<rect x="${starts[i]}" width="${widths[i]}" height="20" fill="${s.color}"/>`).join('');
  const labels = texts
    .map((t, i) => {
      const x = starts[i]! + widths[i]! / 2;
      return `<text x="${x}" y="15" fill="#010101" fill-opacity=".3">${t}</text><text x="${x}" y="14">${t}</text>`;
    })
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${title}">
<title>${title}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)">${rects}<rect width="${total}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
${labels}
</g>
</svg>`;
}

/** The segments of a repo's badge: verified and unverified shares, or why there are none. */
export function repoBadge(stats: Stats | null): BadgeSegment[] {
  const label = { text: 'Ownit', color: LABEL_COLOR };
  if (!stats) return [label, { text: 'not tracked', color: MUTED_COLOR }];
  if (stats.verifiedPct === null) return [label, { text: 'no pushes yet', color: MUTED_COLOR }];
  return [
    label,
    { text: `Verified ${stats.verifiedPct}%`, color: badgeColor(stats.verifiedPct) },
    { text: `Unverified ${stats.unverifiedPct}%`, color: MUTED_COLOR },
  ];
}
