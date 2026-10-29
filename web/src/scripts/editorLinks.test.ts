import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkEditorLinks } from "./editorLinks";
import { api } from "../lib/admin/client";

const links = [{ hidden: true }, { hidden: true }];
let hint: string | null;
const storage = {
  getItem: vi.fn(() => hint),
  setItem: vi.fn((_key: string, value: string) => { hint = value; }),
  removeItem: vi.fn(() => { hint = null; }),
};
const request = vi.fn<typeof fetch>();
const editor = () => Response.json({ email: "editor@example.org" });

beforeEach(() => {
  vi.resetAllMocks();
  hint = "1";
  links.forEach(link => { link.hidden = true; });
  storage.getItem.mockImplementation(() => hint);
  storage.setItem.mockImplementation((_key, value) => { hint = value; });
  storage.removeItem.mockImplementation(() => { hint = null; });
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("document", { querySelectorAll: () => links });
  vi.stubGlobal("fetch", request);
});
afterEach(() => vi.unstubAllGlobals());

describe("public editor links", () => {
  it.each([null, "0"])("makes no request without the hint (%s)", async value => {
    hint = value;
    await checkEditorLinks();
    expect(request).not.toHaveBeenCalled();
    expect(links.every(link => link.hidden)).toBe(true);
  });

  it("keeps Edit and its separator hidden until JSON confirms an editor", async () => {
    let finish: (response: Response) => void = () => {};
    request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = checkEditorLinks();
    expect(links.every(link => link.hidden)).toBe(true);
    expect(request).toHaveBeenCalledWith("/admin/api/me", { redirect: "manual", cache: "no-store" });
    finish(editor());
    await pending;
    expect(links.every(link => !link.hidden)).toBe(true);
    expect(hint).toBe("1");
  });

  it.each([
    ["HTML", () => new Response("sign in", { headers: { "content-type": "text/html" } })],
    ["401", () => Response.json({}, { status: 401 })],
    ["403", () => Response.json({}, { status: 403 })],
    ["Access redirect", () => ({ type: "opaqueredirect", status: 0 }) as Response],
    ["invalid JSON", () => new Response("{", { headers: { "content-type": "application/json" } })],
    ["missing editor", () => Response.json({})],
    ["empty editor", () => Response.json({ email: " " })],
    ["null", () => Response.json(null)],
    ["wrong status", () => Response.json({ email: "editor@example.org" }, { status: 201 })],
  ] as const)("clears the hint and keeps links hidden for %s", async (_name, response) => {
    request.mockResolvedValue(response());
    await checkEditorLinks();
    expect(hint).toBeNull();
    expect(links.every(link => link.hidden)).toBe(true);
  });

  it("clears the hint on a network failure", async () => {
    request.mockRejectedValue(new Error("offline"));
    await expect(checkEditorLinks()).resolves.toBeUndefined();
    expect(hint).toBeNull();
    expect(links.every(link => link.hidden)).toBe(true);
  });

  it("does not fetch or throw when storage access is blocked (MK080)", async () => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    await expect(checkEditorLinks()).resolves.toBeUndefined();
    expect(request).not.toHaveBeenCalled();
    expect(links.every(link => link.hidden)).toBe(true);
  });

  it("does not throw when clearing storage is blocked", async () => {
    request.mockResolvedValue(Response.json({}, { status: 403 }));
    storage.removeItem.mockImplementation(() => { throw new Error("blocked"); });
    await expect(checkEditorLinks()).resolves.toBeUndefined();
    expect(links.every(link => link.hidden)).toBe(true);
  });
});

describe("admin editor hint", () => {
  it("sets the hint after a successful /me", async () => {
    hint = null;
    request.mockResolvedValue(editor());
    expect((await api("/me")).ok).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith("editor", "1");
  });

  it.each([
    () => Response.json({}, { status: 403 }),
    () => new Response("sign in"),
    () => Response.json({}),
    () => Response.json(null),
  ])("clears the hint after an unsuccessful /me", async response => {
    request.mockResolvedValue(response());
    await api("/me");
    expect(hint).toBeNull();
  });

  it("clears the hint when /me cannot be reached", async () => {
    request.mockRejectedValue(new Error("offline"));
    await api("/me");
    expect(hint).toBeNull();
  });

  it("leaves the hint alone for other API calls", async () => {
    request.mockResolvedValue(Response.json({}));
    await api("/counts");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("keeps /me usable when storage writes are blocked", async () => {
    storage.setItem.mockImplementation(() => { throw new Error("blocked"); });
    request.mockResolvedValue(editor());
    expect((await api("/me")).ok).toBe(true);
  });
});
