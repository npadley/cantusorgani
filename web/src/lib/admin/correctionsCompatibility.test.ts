import { describe, expect, it } from "vitest";
import { parseCorrection } from "../../../../workers/corrections/src/schema";
import { buildTargets } from "./targetIndex";
import { pairingMovements } from "./targets";

describe("public intake against the current catalogue", () => {
  it("accepts every current section and movement target", () => {
    const failures: string[] = [];
    for (const piece of Object.values(buildTargets().pieces)) {
      const targets = [
        ...(piece.parts ?? []).map((part) => `part:${piece.slug}/${part.part}${part.variant ? `:${part.variant}` : ""}`),
        ...pairingMovements(piece.genre, piece.movements).map((movement) => `pairing:${piece.slug}/${movement}`),
      ];
      for (const target of targets) {
        if (!parseCorrection({ pieceId: piece.slug, target, field: "gregobaseId", proposedValue: "none" }).ok) failures.push(target);
      }
    }
    expect(failures).toEqual([]);
  });

  it("accepts every current Vespers target", () => {
    const failures = Object.keys(buildTargets().vespers ?? {}).filter((target) =>
      !parseCorrection({ pieceId: "vespers", target, field: "gregobaseId", proposedValue: "none" }).ok);
    expect(failures).toEqual([]);
  });

  it("accepts every current catalogue genre", () => {
    const failures = buildTargets().genres.filter((genre) =>
      !parseCorrection({ pieceId: "kyrie-i", field: "genre", proposedValue: genre }).ok);
    expect(failures).toEqual([]);
  });
});
