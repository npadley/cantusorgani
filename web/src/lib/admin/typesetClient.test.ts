import { describe, expect, it } from "vitest";

import { piece, targets } from "./testing";
import { partChoices, typedTarget } from "./typesetClient";

const T = targets(
  piece("dominica-i-adventus", { label: "Dominica I Adventus", volume: "noh1", genre: "proper",
    parts: [{ part: "introit", variant: "", system: 1, borrowed: null, chant: 1 },
            { part: "alleluia", variant: "paschal", system: 4, borrowed: null, chant: null }] }),
  piece("ordinarium-missae-ix", { label: "IX", movements: ["kyrie", "gloria"] }));

describe("partChoices", () => {
  it("should offer every part, movement and piece in words, sorted", () => {
    expect(partChoices(T)).toEqual([
      { label: "Dominica I Adventus (noh1) · Alleluia paschal", target: "part:dominica-i-adventus/alleluia:paschal" },
      { label: "Dominica I Adventus (noh1) · Introit", target: "part:dominica-i-adventus/introit" },
      { label: "Dominica I Adventus (noh1) · the whole piece", target: "piece:dominica-i-adventus" },
      { label: "IX (noh5) · Gloria", target: "movement:ordinarium-missae-ix/gloria" },
      { label: "IX (noh5) · Kyrie", target: "movement:ordinarium-missae-ix/kyrie" },
      { label: "IX (noh5) · the whole piece", target: "piece:ordinarium-missae-ix" },
    ]);
  });
});

describe("typedTarget", () => {
  const choices = partChoices(T);
  it("should read a suggestion's words, or a target typed as such", () => {
    expect(typedTarget("IX (noh5) · Kyrie", choices)).toBe("movement:ordinarium-missae-ix/kyrie");
    expect(typedTarget(" part:dominica-i-adventus/introit ", choices)).toBe("part:dominica-i-adventus/introit");
  });

  it("should refuse words that are not a suggestion", () => {
    expect(typedTarget("Dominica I Adv", choices)).toBeNull();
    expect(typedTarget("", choices)).toBeNull();
  });
});
