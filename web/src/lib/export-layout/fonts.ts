// B2: the single export font profile (spike S3/S4). Liberation Serif 2.1.5
// (SIL OFL 1.1) is Times-metric-compatible, which is what Verovio lays lyrics
// out with. The fetcher is injected so tests and workers choose the transport.
import type { FontAsset, FontProfile } from './types';

export const FONT_BASE_URL = '/fonts/export/';
export const FONT_FILES = {
  regular: 'LiberationSerif-Regular.ttf',
  italic: 'LiberationSerif-Italic.ttf',
  bold: 'LiberationSerif-Bold.ttf',
} as const;

export const LIBERATION_SERIF_REGULAR_SHA256 = '058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74';
export const LIBERATION_SERIF_ITALIC_SHA256 = '0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e';
export const LIBERATION_SERIF_BOLD_SHA256 = 'd754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce';
export const OFL_LICENSE_SHA256 = '93fed46019c38bbe566b479d22148e2e8a1e85ada614accb0211c37b2c61c19b';

const FAMILY = 'Liberation Serif';
const LICENSE = 'OFL-1.1';

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a plain ArrayBuffer so the digest input type is unambiguous.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadAsset(
  fetchBytes: (url: string) => Promise<Uint8Array>,
  file: string,
  expected: string,
): Promise<FontAsset> {
  const url = FONT_BASE_URL + file;
  let bytes: Uint8Array;
  try {
    bytes = await fetchBytes(url);
  } catch {
    throw new Error(`FONT_UNAVAILABLE: ${file}`);
  }
  if ((await sha256Hex(bytes)) !== expected) throw new Error(`FONT_UNAVAILABLE: ${file}`);
  return { family: FAMILY, url, sha256: expected, license: LICENSE, bytes };
}

/**
 * Fetch and verify the three faces. Lyrics and the regular heading are the
 * same file. The profile digest is the sha256 of the UTF-8 text formed by
 * concatenating the lowercase hex digests of lyricFont, headingRegular,
 * headingItalic and headingBold, in that order.
 */
export async function loadFontProfile(fetchBytes: (url: string) => Promise<Uint8Array>): Promise<FontProfile> {
  const [regular, italic, bold] = await Promise.all([
    loadAsset(fetchBytes, FONT_FILES.regular, LIBERATION_SERIF_REGULAR_SHA256),
    loadAsset(fetchBytes, FONT_FILES.italic, LIBERATION_SERIF_ITALIC_SHA256),
    loadAsset(fetchBytes, FONT_FILES.bold, LIBERATION_SERIF_BOLD_SHA256),
  ]);
  const concatenated = [regular, regular, italic, bold].map((a) => a.sha256).join('');
  const digest = await sha256Hex(new TextEncoder().encode(concatenated));
  return {
    id: 'leipzig+serif',
    musicFont: 'Leipzig',
    lyricFont: regular,
    headingRegular: regular,
    headingItalic: italic,
    headingBold: bold,
    digest,
  };
}
