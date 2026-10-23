import { describe, expect, it } from "vitest";
import cases from "../../../tests/fixtures/identities/model/ref-cases.json";
import { parseRange, parseRef } from "./sourceRefs";

const knownSources = new Set(cases.known_sources);

describe("source refs: shared Python/TS contract", () => {
  for (const testCase of cases.refs) {
    it(testCase.name, () => {
      if ("error" in testCase) {
        expect(() => parseRef(testCase.text, knownSources)).toThrow();
      } else {
        expect(parseRef(testCase.text, knownSources)).toEqual(testCase.result);
      }
    });
  }
  for (const testCase of cases.ranges) {
    it(testCase.name, () => {
      if ("error" in testCase) {
        expect(() => parseRange(testCase.text, knownSources)).toThrow();
      } else {
        expect(parseRange(testCase.text, knownSources)).toEqual(testCase.result);
      }
    });
  }
});
