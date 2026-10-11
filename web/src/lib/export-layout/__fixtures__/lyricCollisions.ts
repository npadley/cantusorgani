import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import type { Font } from '@pdf-lib/fontkit';

const createFont = fontkit.create; // default import: the CJS package has no named ESM exports under plain Node

/**
 * Measures adjacent lyric syllables on a laid-out Verovio page with REAL text widths
 * (fontkit + Liberation Serif Regular), instead of the 0.45 em estimate in evidence.py.
 * Verovio gives lyric text no bounding box, so boxes are rebuilt from each <text>.
 */
let font: Font | undefined;
const liberation = (): Font => {
  font ??= createFont(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'public', 'fonts', 'export', 'LiberationSerif-Regular.ttf')));
  return font;
};

import { lyricBoxes as boxes, lyricCollisions as collisions } from '../lyricGeometry';
export type { LyricBox, LyricCollision } from '../lyricGeometry';

export const lyricBoxes = (svg: string) => boxes(svg, liberation());
export const lyricCollisions = (svg: string, minGapMm = 0.3) => collisions(svg, liberation(), minGapMm);
