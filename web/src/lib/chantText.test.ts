import { expect, it } from "vitest";
import { gabcWords, lyricWords, chantTexts } from "./chantText";
import { pieceBySlug } from "./catalog";

it("joins GABC syllables and removes notation, headers and unsung labels", () => {
  expect(gabcWords("name: secret;\n%%\n(c4) AL(dc)le(c)lú(f){ia}.(g.) (;) <i>ij.</i> <sp>V/</sp>. Lau(h)dem(g) Dó(f)mi(g)ni.(h.)"))
    .toBe("Allelúia. Laudem Dómini.");
});
it("keeps words across LilyPond syllables and nested markup", () => {
  expect(lyricWords('chantText = \\lyricmode { % a comment\n Cre -- do in u -- num De -- um. \\markup { Et } vi -- tam _ A -- men. }'))
    .toEqual(["Credo in unum Deum. Et vitam Amen."]);
});
it("includes verses beyond the incipit on a Proper and the Credos without GABC", () => {
  expect(chantTexts(pieceBySlug("dominica-i-adventus")!).join(" ")).toMatch(/conf[úu]nd[ée]ntur/i);
  expect(chantTexts(pieceBySlug("alii-cantus-ad-libitum-credo-v")!).join(" ")).toContain("resurrectiónem mortuórum");
});

it("never returns markup when removing notation or nested tags assembles a new tag", () => {
  const hostile = 'La(h)udem(g) <<script>script>alert(1)<<script>/script> <scr(a)ipt>text</scr(b)ipt> Dó(f)mi(g)ni.(h)';
  expect(gabcWords(hostile)).not.toMatch(/[<>]/);
});
