/** A parity-tested port of pipeline/typeset/source_check.py. Rendering still
 * runs in the sandbox: this boundary check is not a Scheme security sandbox. */
import rules from "../../../../data/schema/typeset-source-check.json";
export const SOURCE_LIMIT = 60 * 1024;
export const ALLOWED_INCLUDES = rules.includes;
export interface SourceProblem { readonly line: number; readonly message: string }
export function validSourceSize(text: string): boolean { return ![...text].some(c => {const n=c.codePointAt(0)!;return n>=0xd800 && n<=0xdfff;}) && new TextEncoder().encode(text).length <= SOURCE_LIMIT; }

function comments(text: string): string {
  const out = text.split(""); let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (quoted) { if (text[i] === "\\") i++; else if (text[i] === '"') quoted = false; continue; }
    if (text[i] === '"') { quoted = true; continue; }
    if (text[i] !== "%") continue;
    let end = text.startsWith("%{", i) ? text.indexOf("%}", i + 2) : text.indexOf("\n", i);
    if (end < 0) end = text.length; else if (text.startsWith("%{", i)) end += 2;
    for (let j = i; j < end; j++) if (out[j] !== "\n") out[j] = " ";
    i = end - 1;
  }
  return out.join("");
}
function blankStrings(text: string): string {
  const out = text.split("");
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"') continue;
    let j = i + 1;
    while (j < text.length && text[j] !== '"') {
      const end = Math.min(j + (text[j] === "\\" ? 2 : 1), text.length);
      for (; j < end; j++) if (out[j] !== "\n") out[j] = " ";
    }
    i = j;
  }
  return out.join("");
}
function regions(text: string): readonly [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < text.length - 1; i++) {
    let j=i+1;
    while(j<text.length && /\s/.test(text[j]!))j++;
    if (!"#$".includes(text[i]!) || text[j] !== "(") continue;
    let depth = 0;
    for (; j < text.length; j++) {
      if (text[j] === ";") { while (j < text.length && text[j] !== "\n") j++; if (j === text.length) break; }
      else if (text[j] === "(") depth++;
      else if (text[j] === ")" && --depth === 0) break;
    }
    out.push([i, Math.min(j + 1, text.length)]); i = j;
  }
  return out;
}
const IDENT = "[A-Za-z!$%&*/:<=>?^_~+.@-][A-Za-z0-9!$%&*/:<=>?^_~+.@-]*";
const denied = new Set<string>(rules.denied);
export function checkSource(text: string, allowedIncludes: readonly string[] = ALLOWED_INCLUDES): readonly SourceProblem[] {
  const clean = comments(text), code = blankStrings(clean);
  const found: SourceProblem[] = [];
  const add = (offset: number, message: string) => found.push({ line: clean.slice(0, offset).split("\n").length, message });
  const scheme = (offset: number, name: string) => { if (denied.has(name)) add(offset, `Scheme \`${name}\` reaches outside the music, so it is not allowed`); };
  for (const m of code.matchAll(/\\([A-Za-z][A-Za-z-]*)/g)) {
    if(m[1]==="include") {
      const literal=/^\\include\s+"([^"]*)"/.exec(clean.slice(m.index!));
      if(!literal)add(m.index!, "\\include must name a literal allowlisted file");
      else {const name=literal[1]!;if(!allowedIncludes.includes(name) && !rules.lilypondIncludes.includes(name))add(m.index!, `\\include "${name}" is not one of our include files (${[...allowedIncludes].sort().join(", ")}) or LilyPond's own`);}
    }
    if(rules.commands.includes(m[1]!))add(m.index!, `\\${m[1]} reads or writes files, so it is not allowed`);
  }
  for (const m of code.matchAll(new RegExp(`[#$]\\s*(${IDENT})`, "g"))) scheme(m.index!, m[1]!);
  for (const [start, end] of regions(code)) {
    const token = new RegExp(`(?<![A-Za-z0-9!$%&*/:<=>?^_~+.@'-])(${IDENT})`, "g");
    // Keep the original preceding character so lookbehind matches Python's scan.
    token.lastIndex = start + 2;
    let m: RegExpExecArray | null;
    while ((m = token.exec(code)) && m.index < end) scheme(m.index, m[1]!);
  }
  const unique = new Map(found.map((p) => [`${p.line}:${p.message}`, p]));
  return [...unique.values()].sort((a, b) => a.line - b.line || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0));
}
