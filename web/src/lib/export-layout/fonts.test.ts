import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FONT_FILES,
  LIBERATION_SERIF_BOLD_SHA256,
  LIBERATION_SERIF_ITALIC_SHA256,
  LIBERATION_SERIF_REGULAR_SHA256,
  OFL_LICENSE_SHA256,
  loadFontProfile,
  sha256Hex,
} from './fonts';

const DIR = new URL('../../../public/fonts/export/', import.meta.url);
const fromDisk = async (url: string): Promise<Uint8Array> => {
  const file = url.slice(url.lastIndexOf('/') + 1);
  return new Uint8Array(readFileSync(new URL(file, DIR)));
};

describe('fonts', () => {
  it('ships files matching the pinned hashes and the licence text', async () => {
    expect(await sha256Hex(await fromDisk(FONT_FILES.regular))).toBe(LIBERATION_SERIF_REGULAR_SHA256);
    expect(await sha256Hex(await fromDisk(FONT_FILES.italic))).toBe(LIBERATION_SERIF_ITALIC_SHA256);
    expect(await sha256Hex(await fromDisk(FONT_FILES.bold))).toBe(LIBERATION_SERIF_BOLD_SHA256);
    expect(await sha256Hex(await fromDisk('OFL-LiberationFonts.txt'))).toBe(OFL_LICENSE_SHA256);
  });

  it('loads one verified profile with a stable digest', async () => {
    const urls: string[] = [];
    const profile = await loadFontProfile(async (u) => { urls.push(u); return fromDisk(u); });
    expect(urls.sort()).toEqual(Object.values(FONT_FILES).map((f) => `/fonts/export/${f}`).sort());
    expect(profile.id).toBe('leipzig+serif');
    expect(profile.musicFont).toBe('Leipzig');
    expect(profile.lyricFont).toBe(profile.headingRegular);
    expect(profile.headingItalic.sha256).toBe(LIBERATION_SERIF_ITALIC_SHA256);
    expect(profile.headingBold.license).toBe('OFL-1.1');
    const expected = await sha256Hex(
      new TextEncoder().encode(
        LIBERATION_SERIF_REGULAR_SHA256 + LIBERATION_SERIF_REGULAR_SHA256 + LIBERATION_SERIF_ITALIC_SHA256 + LIBERATION_SERIF_BOLD_SHA256,
      ),
    );
    expect(profile.digest).toBe(expected);
    expect((await loadFontProfile(fromDisk)).digest).toBe(profile.digest);
  });

  it('throws FONT_UNAVAILABLE on a hash mismatch', async () => {
    const tampered = async (u: string): Promise<Uint8Array> => {
      const bytes = await fromDisk(u);
      if (u.endsWith('Italic.ttf')) bytes[100] = (bytes[100] ?? 0) ^ 0xff;
      return bytes;
    };
    await expect(loadFontProfile(tampered)).rejects.toThrow('FONT_UNAVAILABLE: LiberationSerif-Italic.ttf');
  });

  it('throws FONT_UNAVAILABLE when the fetch fails', async () => {
    const failing = async (u: string): Promise<Uint8Array> => {
      if (u.endsWith('Bold.ttf')) throw new Error('network down');
      return fromDisk(u);
    };
    await expect(loadFontProfile(failing)).rejects.toThrow('FONT_UNAVAILABLE: LiberationSerif-Bold.ttf');
  });
});
