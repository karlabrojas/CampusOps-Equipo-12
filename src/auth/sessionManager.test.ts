import { CampusOpsClient } from "../api/campusOpsClient";
import {
  SessionManager,
  type SessionStorage,
} from "./sessionManager";

class MemorySessionStorage implements SessionStorage {
  value: string | null = null;

  async get(): Promise<string | null> {
    return this.value;
  }

  async set(value: string): Promise<void> {
    this.value = value;
  }

  async clear(): Promise<void> {
    this.value = null;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function loginResponse() {
  return {
    actorId: "reporter-1",
    role: "reporter",
    accessToken: "test-access-1",
    refreshToken: "test-refresh-1",
    expiresIn: 60,
  };
}

describe("SessionManager", () => {
  it("transitions through login and provides a valid persisted session", async () => {
    const storage = new MemorySessionStorage();
    const states: string[] = [];
    const manager = new SessionManager({
      storage,
      now: () => 10_000,
      fetcher: (async () => jsonResponse(loginResponse())) as typeof fetch,
    });
    manager.subscribe((state) => states.push(state.status));

    const session = await manager.login("reporter-1");

    expect(states).toEqual([
      "unauthenticated",
      "signingIn",
      "authenticated",
    ]);
    expect(session).toMatchObject({
      actorId: "reporter-1",
      role: "reporter",
      expiresAt: 70_000,
    });
    expect(manager.currentSession).toEqual(session);
    expect(JSON.parse(storage.value ?? "{}")).toMatchObject(session);
  });

  it("detects expiration and transitions through a successful refresh", async () => {
    const storage = new MemorySessionStorage();
    let now = 10_000;
    const paths: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      const path = String(input);
      paths.push(path);
      if (path.endsWith("/v1/session/login")) {
        return jsonResponse(loginResponse());
      }
      return jsonResponse({
        accessToken: "test-access-2",
        refreshToken: "test-refresh-2",
        expiresIn: 120,
      });
    }) as typeof fetch;
    const manager = new SessionManager({ storage, fetcher, now: () => now });
    await manager.login("reporter-1");

    now = 70_000;
    expect(manager.state.status).toBe("expired");
    const renewed = await manager.getValidSession();

    expect(renewed).toMatchObject({
      actorId: "reporter-1",
      accessToken: "test-access-2",
    });
    expect(manager.state.status).toBe("authenticated");
    expect(JSON.parse(storage.value ?? "{}")).toMatchObject({
      accessToken: "test-access-2",
      refreshToken: "test-refresh-2",
      expiresAt: 190_000,
    });
    expect(paths).toHaveLength(2);
    expect(paths[1]?.endsWith("/v1/session/refresh")).toBe(true);
  });

  it("restores a still-valid session without exposing its credentials in state", async () => {
    const storage = new MemorySessionStorage();
    storage.value = JSON.stringify({
      ...loginResponse(),
      expiresAt: 70_000,
    });
    const manager = new SessionManager({
      storage,
      now: () => 10_000,
      fetcher: jest.fn() as typeof fetch,
    });

    await manager.restore();

    expect(manager.state).toEqual({
      status: "authenticated",
      session: {
        actorId: "reporter-1",
        role: "reporter",
        expiresAt: 70_000,
      },
    });
    expect(manager.currentSession).not.toHaveProperty("accessToken");
    expect(manager.currentSession).not.toHaveProperty("refreshToken");
    expect(await manager.getValidSession()).toEqual({
      actorId: "reporter-1",
      accessToken: "test-access-1",
    });
  });

  it("clears persisted state and becomes unauthenticated when an expired session cannot refresh", async () => {
    const storage = new MemorySessionStorage();
    let now = 10_000;
    const manager = new SessionManager({
      storage,
      now: () => now,
      fetcher: (async (input: RequestInfo | URL) => {
        return String(input).endsWith("/v1/session/login")
          ? jsonResponse(loginResponse())
          : jsonResponse({ code: "invalid_grant" }, 401);
      }) as typeof fetch,
    });
    await manager.login("reporter-1");
    now = 70_000;

    expect(manager.state.status).toBe("expired");
    const refreshed = await manager.getValidSession();

    expect(refreshed).toBeNull();
    expect(manager.state.status).toBe("unauthenticated");
    expect(manager.currentSession).toBeNull();
    expect(storage.value).toBeNull();
  });

  it("shares one in-flight refresh across concurrent callers", async () => {
    const storage = new MemorySessionStorage();
    let refreshCalls = 0;
    let resolveRefresh: ((response: Response) => void) | undefined;
    let refreshStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      refreshStarted = resolve;
    });
    const manager = new SessionManager({
      storage,
      fetcher: (async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/v1/session/login")) {
          return jsonResponse(loginResponse());
        }
        refreshCalls += 1;
        refreshStarted?.();
        return new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        });
      }) as typeof fetch,
    });
    await manager.login("reporter-1");

    const first = manager.refreshSession();
    const second = manager.refreshSession();
    await started;
    expect(refreshCalls).toBe(1);
    resolveRefresh?.(
      jsonResponse({
        accessToken: "test-access-2",
        refreshToken: "test-refresh-2",
        expiresIn: 60,
      }),
    );

    await expect(Promise.all([first, second])).resolves.toEqual([
      { actorId: "reporter-1", accessToken: "test-access-2" },
      { actorId: "reporter-1", accessToken: "test-access-2" },
    ]);
  });

  it("removes persisted and in-memory credentials on logout", async () => {
    const storage = new MemorySessionStorage();
    const manager = new SessionManager({
      storage,
      fetcher: (async () => jsonResponse(loginResponse())) as typeof fetch,
    });
    await manager.login("reporter-1");
    expect(storage.value).not.toBeNull();

    await manager.logout();

    expect(manager.state.status).toBe("unauthenticated");
    expect(manager.currentSession).toBeNull();
    expect(await manager.getValidSession()).toBeNull();
    expect(storage.value).toBeNull();
  });

  it("does not let an in-flight refresh restore credentials after logout", async () => {
    const storage = new MemorySessionStorage();
    let resolveRefresh: ((response: Response) => void) | undefined;
    let refreshStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      refreshStarted = resolve;
    });
    const manager = new SessionManager({
      storage,
      fetcher: (async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/v1/session/login")) {
          return jsonResponse(loginResponse());
        }
        refreshStarted?.();
        return new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        });
      }) as typeof fetch,
    });
    await manager.login("reporter-1");

    const refresh = manager.refreshSession();
    await started;
    await manager.logout();
    resolveRefresh?.(
      jsonResponse({
        accessToken: "late-access",
        refreshToken: "late-refresh",
        expiresIn: 60,
      }),
    );

    await expect(refresh).resolves.toBeNull();
    expect(manager.state.status).toBe("unauthenticated");
    expect(manager.currentSession).toBeNull();
    expect(storage.value).toBeNull();
  });

  it("refreshes once after an API 401 and retries with the new access token", async () => {
    const storage = new MemorySessionStorage();
    const calls: { url: string; authorization: string | null }[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        authorization: new Headers(init?.headers).get("Authorization"),
      });
      if (url.endsWith("/v1/session/login")) {
        return jsonResponse(loginResponse());
      }
      if (url.endsWith("/v1/session/refresh")) {
        return jsonResponse({
          accessToken: "test-access-2",
          refreshToken: "test-refresh-2",
          expiresIn: 60,
        });
      }
      const resourceCalls = calls.filter((call) =>
        call.url.endsWith("/v1/incidents"),
      );
      return resourceCalls.length === 1
        ? jsonResponse({ code: "unauthorized" }, 401)
        : jsonResponse({ items: [] });
    }) as typeof fetch;
    const manager = new SessionManager({ storage, fetcher });
    const client = new CampusOpsClient({
      sessionProvider: manager,
      fetcher,
      baseUrl: "http://backend.test",
    });
    await manager.login("reporter-1");

    await expect(client.findAll()).resolves.toEqual([]);

    const resourceCalls = calls.filter((call) =>
      call.url.endsWith("/v1/incidents"),
    );
    expect(resourceCalls).toHaveLength(2);
    expect(resourceCalls.map((call) => call.authorization)).toEqual([
      "Bearer test-access-1",
      "Bearer test-access-2",
    ]);
  });
});
