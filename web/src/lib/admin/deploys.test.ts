import { describe, expect, it } from "vitest";

import { deployState, when } from "./deploys";
import type { Run } from "./deploys";

const run = (extra: Partial<Run> = {}): Run => ({
  name: "site", event: "push", status: "completed", conclusion: "success",
  html_url: "https://github.com/npadley/cantusorgani/actions/runs/1", updated_at: "2026-10-03T14:05:00Z", ...extra,
});
const MERGED = "2026-10-03 14:02:00";

describe("deployState", () => {
  it("should say a batch is live once the site workflow has deployed its merge commit", () => {
    expect(deployState([run({ name: "corrections-batch" }), run()], MERGED))
      .toMatchObject({ live: true, pending: false, words: expect.stringMatching(/^Live on the site since /) });
  });

  it("should say it is building, or not started, and to ask again", () => {
    expect(deployState([run({ status: "in_progress", conclusion: null })], MERGED))
      .toMatchObject({ live: false, pending: true, words: expect.stringContaining("building and deploying") });
    expect(deployState([], MERGED)).toMatchObject({ pending: true, words: expect.stringContaining("has not started") });
  });

  it("should point to the run when the deploy failed, and say what it can when GitHub cannot be asked", () => {
    expect(deployState([run({ conclusion: "failure" })], MERGED))
      .toMatchObject({ live: false, pending: false, href: expect.stringContaining("/runs/1") });
    expect(deployState(null, MERGED)).toMatchObject({ pending: false, href: null,
                                                      words: expect.stringContaining("a few minutes after a merge") });
  });
});

describe("when", () => {
  it("should read the database's UTC time and GitHub's, and leave anything else as it is", () => {
    expect(when("2026-10-03 14:02:00", "en-GB")).toMatch(/^3 Oct, \d\d:02$/);
    expect(when("2026-10-03T14:05:00Z", "en-GB")).toMatch(/^3 Oct, \d\d:05$/);
    expect(when("soon")).toBe("soon");
  });
});
