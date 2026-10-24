import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RUBRIC_RED } from "../lib/export-layout/chantRender";

// The Loft palette (docs: redesign/concepts/loft/tokens-delta.md): the exact
// values, and the contrast each pair must keep in light, dark and Invert.
const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

type Tokens = Readonly<Record<string, string>>;

function parseBlock(selector: string): Tokens {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Missing token block: ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const entries: [string, string][] = [];
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) entries.push([name, value.trim()]);
  }
  return Object.fromEntries(entries);
}

function get(tokens: Tokens, name: string): string {
  const value = tokens[name];
  if (value === undefined) throw new Error(`Missing token ${name}`);
  return value;
}

const light = parseBlock(':root, :root[data-scan-polarity="normal"]');
const dark = parseBlock(':root:not([data-scan-polarity="normal"])');
const inverted = parseBlock(':root[data-scan-polarity="inverted"]');
const colours = ["gold", "white", "red", "green", "violet", "rose", "black"] as const;

function luminance(hex: string): number {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`Expected a six-digit hex colour: ${hex}`);
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

it("PDF rubric ink on white meets 7:1", () => {
  expect(contrast(RUBRIC_RED, "#ffffff")).toBeGreaterThanOrEqual(7);
});

it("light tokens have the Loft values", () => {
  expect(light).toMatchObject({
    "--paper": "#f7f7f4", "--ink": "#202522", "--ink-muted": "#485048", "--rule": "#cbd0ca",
    "--control-border": "#777f77", "--accent": "#8b2727", "--rubric": "#a00000",
    "--surface": "#eeeeea", "--warn-bg": "#f7f7f4", "--warn-ink": "#8b2727",
    "--day-gold": "#b89a50", "--day-white": "#f6f3ea", "--day-red": "#9b1c1c",
    "--day-green": "#2e6b30", "--day-violet": "#5b2a86", "--day-rose": "#d98aa6",
    "--day-black": "#111111", "--print-paper": "#ffffff", "--print-ink": "#000000",
  });
});

it("dark tokens have the Loft values", () => {
  expect(dark).toMatchObject({
    "--paper": "#171c19", "--ink": "#eeefe9", "--ink-muted": "#b8c1b9", "--rule": "#3d4840",
    "--control-border": "#879389", "--accent": "#f0aaa2", "--rubric": "#f0aaa2",
    "--surface": "#222a24", "--warn-bg": "#171c19", "--warn-ink": "#f0aaa2",
    "--day-gold": "#d4b66a", "--day-white": "#f6f3ea", "--day-red": "#d86b6b",
    "--day-green": "#79ae7b", "--day-violet": "#b18bd2", "--day-rose": "#d98aa6",
    "--day-black": "#8e9490",
  });
});

it("dark and inverted declare identical tokens", () => {
  expect(inverted).toEqual(dark);
});

for (const [name, tokens] of Object.entries({ light, dark, inverted })) {
  describe(`${name} contrast`, () => {
    for (const token of ["--ink", "--ink-muted", "--accent", "--rubric"]) {
      it(`${token} on paper meets 7:1`, () => {
        expect(contrast(get(tokens, token), get(tokens, "--paper"))).toBeGreaterThanOrEqual(7);
      });
    }

    it("warning text meets 7:1", () => {
      expect(contrast(get(tokens, "--warn-ink"), get(tokens, "--warn-bg"))).toBeGreaterThanOrEqual(7);
    });

    it("control edges and marker outlines on paper meet 3:1", () => {
      expect(contrast(get(tokens, "--control-border"), get(tokens, "--paper"))).toBeGreaterThanOrEqual(3);
    });

    // Pale light-mode fills (white, gold, rose) rely on the outline above.
    if (name !== "light") {
      for (const colour of colours) {
        it(`${colour} day mark on paper meets 3:1`, () => {
          expect(contrast(get(tokens, `--day-${colour}`), get(tokens, "--paper"))).toBeGreaterThanOrEqual(3);
        });
      }
    }
  });
}
