import { expect, it } from "vitest";

it("keeps source-specific candidates separate from verified notation", async () => {
  const { parseHymnPairings } = await import("./hymnpairings");
  const row = { slug: "creator", title: "Creator", id: 2134, status: "unverified",
    incipit: "Creator alme siderum", mode: "4", evidence: "Related text; melody unconfirmed",
    sources: ["https://gregobase.selapa.net/chant.php?id=2134"], copyrighted: false };
  expect(parseHymnPairings({ pairings: { "noh7/0040/000": row } }).get("noh7/0040/000")?.status).toBe("unverified");
  expect(() => parseHymnPairings({ pairings: { "noh7/0040/000": { ...row, status: "verified", copyrighted: true } } })).toThrow();
  expect(() => parseHymnPairings({ pairings: { "noh7/0040/000": { ...row, id: null, status: "verified" } } })).toThrow();
});

it("accounts for every indexed setting and shows notation only for reviewed matches", async () => {
  const { hymnIndex, jumpTargets, allPieces } = await import("./catalog");
  const { hymnPairing } = await import("./hymnpairings");
  const { chantEntry } = await import("./chants");
  for (const h of hymnIndex()) {
    const pairing = hymnPairing(h.ref);
    expect(pairing, `${h.title}: ${h.ref}`).toBeDefined();
    const target = jumpTargets(h.piece).find((t) => h.piece.systems[t.index] === h.ref);
    if (pairing?.status === "verified") {
      expect(target?.chantId, h.ref).toBe(pairing.id);
      if (pairing.notation_available) expect(chantEntry(pairing.id), h.ref).toBeDefined();
    } else {
      expect(target?.chantId ?? null, h.ref).toBeNull();
    }
  }
  const fragment = allPieces().find((p) => p.slug === "varia-en-ut-superba-criminum")!;
  expect(hymnPairing(fragment.systems[0]!)?.status).toBe("unverified");
  expect(jumpTargets(fragment)).toHaveLength(0);
});
