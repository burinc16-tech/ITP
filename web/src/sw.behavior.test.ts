import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The service worker can't run in jsdom, so we load its source into a controlled
 * scope with fake `caches`/`fetch` and drive the real install/fetch handlers.
 * This exercises the behaviours SPEC §8 depends on — the API is never cached,
 * hashed assets are cache-first, and the shell is served offline — without a
 * browser.
 */
const ORIGIN = "http://localhost";

type Res = { ok: boolean; url: string; clone: () => Res; tag: string };
const makeRes = (url: string, ok = true): Res => ({
  ok,
  url,
  tag: url,
  clone() {
    return makeRes(url, ok);
  },
});

const keyOf = (req: string | { url: string }): string =>
  typeof req === "string" ? req : req.url;

class FakeCache {
  store = new Map<string, Res>();
  constructor(private readonly netFetch: (req: unknown) => Promise<Res>) {}
  async match(req: string | { url: string }): Promise<Res | undefined> {
    return this.store.get(keyOf(req));
  }
  async put(req: string | { url: string }, res: Res): Promise<void> {
    this.store.set(keyOf(req), res);
  }
  async add(req: string): Promise<void> {
    this.store.set(keyOf(req), await this.netFetch(req));
  }
}

class FakeCaches {
  map = new Map<string, FakeCache>();
  constructor(private readonly netFetch: (req: unknown) => Promise<Res>) {}
  async open(name: string): Promise<FakeCache> {
    if (!this.map.has(name)) this.map.set(name, new FakeCache(this.netFetch));
    return this.map.get(name)!;
  }
  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
  async delete(name: string): Promise<boolean> {
    return this.map.delete(name);
  }
}

interface Handlers {
  install?: (e: { waitUntil: (p: Promise<unknown>) => void }) => void;
  activate?: (e: { waitUntil: (p: Promise<unknown>) => void }) => void;
  fetch?: (e: { request: unknown; respondWith: (p: Promise<Res>) => void }) => void;
}

function loadSw(fetchMock: (req: unknown) => Promise<Res>) {
  const src = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
  const handlers: Handlers = {};
  const scope = {
    location: { origin: ORIGIN },
    addEventListener: (type: keyof Handlers, handler: unknown) => {
      handlers[type] = handler as never;
    },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const caches = new FakeCaches(fetchMock);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("self", "caches", "fetch", src)(scope, caches, fetchMock);
  return { handlers, caches };
}

const req = (path: string, init: { method?: string; mode?: string } = {}) => ({
  url: `${ORIGIN}${path}`,
  method: init.method ?? "GET",
  mode: init.mode ?? "cors",
});

/** Run the fetch handler; resolve the response, or undefined if not intercepted. */
async function handleFetch(handlers: Handlers, request: unknown): Promise<Res | undefined> {
  let captured: Promise<Res> | undefined;
  handlers.fetch!({ request, respondWith: (p) => (captured = p) });
  return captured ? await captured : undefined;
}

async function runInstall(handlers: Handlers): Promise<void> {
  const pending: Promise<unknown>[] = [];
  handlers.install!({ waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
}

describe("service worker behaviour", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async (r: unknown) => makeRes(keyOf(r as { url: string })));
  });

  it("never intercepts the API — records stay fresh, offline writes go to the queue", async () => {
    const { handlers } = loadSw(fetchMock);
    expect(await handleFetch(handlers, req("/api/records"))).toBeUndefined();
    expect(await handleFetch(handlers, req("/api/records", { method: "POST" }))).toBeUndefined();
  });

  it("never intercepts non-GET or cross-origin requests", async () => {
    const { handlers } = loadSw(fetchMock);
    expect(await handleFetch(handlers, req("/assets/app.js", { method: "POST" }))).toBeUndefined();
    const crossOrigin = { url: "https://cdn.example.com/x.js", method: "GET", mode: "cors" };
    expect(await handleFetch(handlers, crossOrigin)).toBeUndefined();
  });

  it("serves content-hashed assets cache-first (second hit skips the network)", async () => {
    const { handlers } = loadSw(fetchMock);
    const asset = req("/assets/app-abc123.js");
    const first = await handleFetch(handlers, asset);
    expect(first?.tag).toBe(`${ORIGIN}/assets/app-abc123.js`);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await handleFetch(handlers, asset);
    expect(second?.tag).toBe(`${ORIGIN}/assets/app-abc123.js`);
    expect(fetchMock).toHaveBeenCalledTimes(1); // served from cache, no refetch
  });

  it("precaches the shell on install and serves it when a navigation is offline", async () => {
    const { handlers, caches } = loadSw(fetchMock);
    await runInstall(handlers); // cache.add("/")
    const shell = (await caches.open("itp-itr-v1")).store.get("/");
    expect(shell).toBeDefined();

    // Go offline: the network throws, so the precached shell must answer.
    fetchMock.mockRejectedValue(new Error("offline"));
    const nav = await handleFetch(handlers, req("/", { mode: "navigate" }));
    expect(nav).toBe(shell);
  });

  it("navigations are network-first when online, refreshing the shell", async () => {
    const { handlers, caches } = loadSw(fetchMock);
    await runInstall(handlers);
    const nav = await handleFetch(handlers, req("/", { mode: "navigate" }));
    expect(nav?.ok).toBe(true);
    // The fresh root response replaced the shell entry.
    expect((await caches.open("itp-itr-v1")).store.get("/")?.tag).toBe(`${ORIGIN}/`);
  });

  it("does not store a /sign navigation as the offline shell", async () => {
    const { handlers, caches } = loadSw(fetchMock);
    await runInstall(handlers);
    const shellBefore = (await caches.open("itp-itr-v1")).store.get("/")?.tag;
    await handleFetch(handlers, req("/sign/deadbeef", { mode: "navigate" }));
    // Shell entry is unchanged — only the root path may overwrite it.
    expect((await caches.open("itp-itr-v1")).store.get("/")?.tag).toBe(shellBefore);
  });
});
