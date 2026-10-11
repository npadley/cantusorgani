import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { trackExport } from "./exportAnalytics";

// Mock window object for testing
const mockWindow = {
  goatcounter: undefined as any,
};

describe("trackExport", () => {
  let originalGoatCounter: unknown;

  beforeEach(() => {
    // Save the original goatcounter
    originalGoatCounter = mockWindow.goatcounter;
  });

  afterEach(() => {
    // Restore the original goatcounter
    if (originalGoatCounter === undefined) {
      mockWindow.goatcounter = undefined;
    } else {
      mockWindow.goatcounter = originalGoatCounter;
    }
  });

  // Helper to mock window globally for tests
  function withMockedWindow(fn: () => void) {
    const originalGlobal = (globalThis as any).window;
    (globalThis as any).window = mockWindow;
    try {
      fn();
    } finally {
      (globalThis as any).window = originalGlobal;
    }
  }

  it("calls goatcounter with exact arguments when present", () => {
    withMockedWindow(() => {
      const mockCount = vi.fn();
      mockWindow.goatcounter = { count: mockCount };

      trackExport("quick", { paper: "letter" });

      expect(mockCount).toHaveBeenCalledWith({
        path: "export/quick",
        title: "paper=letter",
        event: true,
      });
    });
  });

  it("constructs title with sorted keys and key=value format", () => {
    withMockedWindow(() => {
      const mockCount = vi.fn();
      mockWindow.goatcounter = { count: mockCount };

      trackExport("custom", {
        linePolicy: "original",
        orientation: "portrait",
        staff: "7.2",
        page: "letter",
        maxSystems: "10",
      });

      expect(mockCount).toHaveBeenCalledWith({
        path: "export/custom",
        title: "linePolicy=original, maxSystems=10, orientation=portrait, page=letter, staff=7.2",
        event: true,
      });
    });
  });

  it("does not throw when goatcounter is absent", () => {
    withMockedWindow(() => {
      mockWindow.goatcounter = undefined;

      expect(() => {
        trackExport("quick", { paper: "a4" });
      }).not.toThrow();
    });
  });

  it("does not throw when goatcounter.count throws", () => {
    withMockedWindow(() => {
      const mockCount = vi.fn(() => {
        throw new Error("Simulated goatcounter error");
      });
      mockWindow.goatcounter = { count: mockCount };

      expect(() => {
        trackExport("quick", { paper: "letter" });
      }).not.toThrow();
    });
  });

  it("drops unknown keys and only includes allowed keys", () => {
    withMockedWindow(() => {
      const mockCount = vi.fn();
      mockWindow.goatcounter = { count: mockCount };

      trackExport("custom", {
        page: "letter",
        orientation: "portrait",
        staff: "7.2",
        maxSystems: "10",
        linePolicy: "automatic",
        paper: "a4",
        unknownKey: "should-be-dropped",
        anotherBad: "also-dropped",
        userId: "secret-id",
      });

      expect(mockCount).toHaveBeenCalledWith({
        path: "export/custom",
        title: "linePolicy=automatic, maxSystems=10, orientation=portrait, page=letter, paper=a4, staff=7.2",
        event: true,
      });

      // Verify that unknown keys are not in the title
      const call = mockCount.mock.calls[0]?.[0];
      if (call) {
        expect(call.title).not.toContain("unknownKey");
        expect(call.title).not.toContain("anotherBad");
        expect(call.title).not.toContain("userId");
      }
    });
  });

  it("maintains deterministic key order with multiple calls", () => {
    withMockedWindow(() => {
      const mockCount = vi.fn();
      mockWindow.goatcounter = { count: mockCount };

      const details = {
        staff: "7.2",
        page: "letter",
        linePolicy: "automatic",
        maxSystems: "10",
        orientation: "portrait",
      };

      trackExport("custom", details);
      const firstTitle = (mockCount.mock.calls[0]?.[0] as any)?.title;

      mockCount.mockClear();

      // Call again with same details in different order
      const detailsReordered = {
        orientation: "portrait",
        maxSystems: "10",
        linePolicy: "automatic",
        page: "letter",
        staff: "7.2",
      };

      trackExport("custom", detailsReordered);
      const secondTitle = (mockCount.mock.calls[0]?.[0] as any)?.title;

      expect(firstTitle).toBe(secondTitle);
    });
  });

  it("handles quick export with paper key", () => {
    withMockedWindow(() => {
      const mockCount = vi.fn();
      mockWindow.goatcounter = { count: mockCount };

      trackExport("quick", { paper: "letter" });

      expect(mockCount).toHaveBeenCalledWith({
        path: "export/quick",
        title: "paper=letter",
        event: true,
      });
    });
  });

  it("handles empty details object", () => {
    withMockedWindow(() => {
      const mockCount = vi.fn();
      mockWindow.goatcounter = { count: mockCount };

      trackExport("quick", {});

      expect(mockCount).toHaveBeenCalledWith({
        path: "export/quick",
        title: "",
        event: true,
      });
    });
  });
});
