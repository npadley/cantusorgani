// Spike S4 (not shipped): a minimal XML reader for Verovio's SVG output.
// Workers have no DOMParser, so route (ii) needs its own parser. It accepts
// well-formed XML only (Verovio output after B5 sanitisation) and throws on
// anything it does not understand rather than guessing.

export interface XmlElement {
  readonly name: string;
  readonly attrs: ReadonlyMap<string, string>;
  readonly children: readonly XmlNode[];
}
export type XmlNode = XmlElement | string;

const NAME = /[A-Za-z_][\w.:-]*/y;
const ATTR = /\s*([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/y;

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, ent: string) => {
    switch (ent) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default: {
        const cp = ent.startsWith("#x") ? Number.parseInt(ent.slice(2), 16) : Number.parseInt(ent.slice(1), 10);
        return String.fromCodePoint(cp);
      }
    }
  });
}

interface MutableElement { name: string; attrs: Map<string, string>; children: XmlNode[] }

export function parseXml(src: string): XmlElement {
  const stack: MutableElement[] = [];
  let root: MutableElement | null = null;
  let i = 0;
  const top = (): MutableElement | undefined => stack[stack.length - 1];
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    const textEnd = lt === -1 ? src.length : lt;
    if (textEnd > i) {
      const text = src.slice(i, textEnd);
      const parent = top();
      if (parent !== undefined) parent.children.push(decodeEntities(text));
      else if (text.trim() !== "") throw new Error("text outside the root element");
    }
    if (lt === -1) break;
    if (src.startsWith("<?", lt)) { i = src.indexOf("?>", lt) + 2; continue; }
    if (src.startsWith("<!--", lt)) { i = src.indexOf("-->", lt) + 3; continue; }
    if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt);
      top()?.children.push(src.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (src.startsWith("<!", lt)) throw new Error("DOCTYPE and declarations are not accepted");
    if (src.startsWith("</", lt)) {
      const gt = src.indexOf(">", lt);
      const name = src.slice(lt + 2, gt).trim();
      const open = stack.pop();
      if (open?.name !== name) throw new Error(`mismatched </${name}>`);
      i = gt + 1;
      continue;
    }
    NAME.lastIndex = lt + 1;
    const nameMatch = NAME.exec(src);
    if (nameMatch === null) throw new Error(`bad tag at ${lt}`);
    const el: MutableElement = { name: nameMatch[0], attrs: new Map(), children: [] };
    i = NAME.lastIndex;
    for (;;) {
      ATTR.lastIndex = i;
      const a = ATTR.exec(src);
      if (a === null) break;
      const key = a[1];
      const value = a[3] ?? a[4] ?? "";
      if (key !== undefined) el.attrs.set(key, decodeEntities(value));
      i = ATTR.lastIndex;
    }
    while (src[i] === " " || src[i] === "\n" || src[i] === "\t" || src[i] === "\r") i++;
    const parent = top();
    if (parent !== undefined) parent.children.push(el);
    else if (root === null) root = el;
    else throw new Error("more than one root element");
    if (src.startsWith("/>", i)) { i += 2; continue; }
    if (src[i] !== ">") throw new Error(`bad tag end at ${i}`);
    i += 1;
    stack.push(el);
  }
  if (stack.length > 0 || root === null) throw new Error("unterminated document");
  return root;
}
