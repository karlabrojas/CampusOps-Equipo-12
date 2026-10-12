import { SessionManager, type SessionState, type SessionStorage } from "./sessionManager";

// Pruebas de falla de autenticacion (Semana 6, issue #41): refresh fallido,
// refresh obsoleto/invalido, logout sin tokens y logs sin tokens.
// Reloj, storage y fetcher inyectados: sin esperas temporizadas.

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

const TOKENS = ["test-access-1", "test-refresh-1", "test-access-2", "test-refresh-2"];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function loginBody() {
  return {
    actorId: "technician-1",
    role: "technician",
    accessToken: "test-access-1",
    refreshToken: "test-refresh-1",
    expiresIn: 60,
  };
}

function setup(refresh: () => Promise<Response> | Response) {
  const storage = new MemorySessionStorage();
  let now = 10_000;
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const path = String(input);
    calls.push(path);
    if (path.endsWith("/v1/session/login")) return jsonResponse(loginBody());
    if (path.endsWith("/v1/session/refresh")) return refresh();
    return jsonResponse({ error: "not-found" }, 404);
  }) as typeof fetch;
  const manager = new SessionManager({ storage, fetcher, now: () => now });
  return {
    storage,
    manager,
    expire: () => {
      now = 70_000; // expiresAt = 10_000 + 60 * 1000
    },
    refreshCalls: () => calls.filter((p) => p.endsWith("/v1/session/refresh")).length,
  };
}

const rejected = () => jsonResponse({ error: "invalid_refresh_token" }, 401);

describe("T-07 refresh fallido", () => {
  it("failure: un refresh rechazado deja la sesion no autenticada y sin tokens persistidos", async () => {
    const { manager, storage, expire, refreshCalls } = setup(rejected);
    await manager.login("technician-1");
    expect(storage.value).not.toBeNull();

    expire();
    await expect(manager.getValidSession()).resolves.toBeNull();

    expect(manager.state.status).toBe("unauthenticated");
    expect(manager.currentSession).toBeNull();
    expect(storage.value).toBeNull();
    expect(refreshCalls()).toBe(1);
  });

  it("failure: una respuesta de refresh con contrato invalido limpia la sesion", async () => {
    const { manager, storage, expire } = setup(() =>
      jsonResponse({ accessToken: "test-access-2" }),
    );
    await manager.login("technician-1");
    expire();

    await expect(manager.getValidSession()).rejects.toThrow(/session contract/);

    expect(manager.state.status).toBe("unauthenticated");
    expect(storage.value).toBeNull();
  });
});

describe("T-07 refresh obsoleto/invalido", () => {
  it("failure: un refresh token obsoleto no genera renovaciones repetidas (sin loop)", async () => {
    const { manager, expire, refreshCalls } = setup(rejected);
    await manager.login("technician-1");
    expire();

    await expect(manager.getValidSession()).resolves.toBeNull();
    expect(refreshCalls()).toBe(1);

    for (let i = 0; i < 5; i += 1) {
      await expect(manager.getValidSession()).resolves.toBeNull();
    }
    expect(refreshCalls()).toBe(1);
  });

  it("failure: solicitudes concurrentes con refresh obsoleto comparten UN solo intento", async () => {
    const { manager, expire, refreshCalls } = setup(rejected);
    await manager.login("technician-1");
    expire();

    const results = await Promise.all([
      manager.getValidSession(),
      manager.getValidSession(),
      manager.getValidSession(),
    ]);

    expect(results).toEqual([null, null, null]);
    expect(refreshCalls()).toBe(1);
    expect(manager.state.status).toBe("unauthenticated");
  });

  it("boundary: una respuesta de refresh que llega despues del logout se descarta", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { manager, storage, expire } = setup(async () => {
      await gate;
      return jsonResponse({
        accessToken: "test-access-2",
        refreshToken: "test-refresh-2",
        expiresIn: 120,
      });
    });
    await manager.login("technician-1");
    expire();

    const pending = manager.getValidSession();
    await manager.logout();
    release();

    await expect(pending).resolves.toBeNull();
    expect(storage.value).toBeNull();
    expect(manager.currentSession).toBeNull();
    expect(manager.state.status).toBe("unauthenticated");
  });
});

describe("T-07 logout sin tokens", () => {
  it("nominal: logout elimina el token persistido y pasa por loggingOut a unauthenticated", async () => {
    const { manager, storage } = setup(rejected);
    const states: string[] = [];
    await manager.login("technician-1");
    manager.subscribe((state) => states.push(state.status));
    expect(storage.value).toContain("test-access-1");

    await manager.logout();

    expect(storage.value).toBeNull();
    expect(manager.currentSession).toBeNull();
    expect(states).toEqual(["authenticated", "loggingOut", "unauthenticated"]);
  });

  it("failure: despues del logout no hay credenciales ni se intenta renovar", async () => {
    const { manager, refreshCalls } = setup(rejected);
    await manager.login("technician-1");
    await manager.logout();

    await expect(manager.getValidSession()).resolves.toBeNull();
    await expect(manager.refreshSession()).resolves.toBeNull();
    expect(refreshCalls()).toBe(0);
  });

  it("boundary: restaurar tras el logout no recupera ninguna sesion", async () => {
    const { manager, storage } = setup(rejected);
    await manager.login("technician-1");
    await manager.logout();

    const state = await manager.restore();

    expect(state.status).toBe("unauthenticated");
    expect(await storage.get()).toBeNull();
  });
});

describe("T-07 tokens fuera de logs y de la UI", () => {
  it("failure: login, expiracion, refresh con error y logout no escriben tokens en consola ni en el estado de UI", async () => {
    const methods = ["log", "info", "warn", "error", "debug"] as const;
    const spies = methods.map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    const observed: SessionState[] = [];
    let errorMessage = "";
    try {
      const { manager, expire } = setup(() =>
        jsonResponse({ accessToken: "test-access-2" }),
      );
      manager.subscribe((state) => observed.push(state));
      await manager.login("technician-1");
      observed.push({ status: "authenticated", session: manager.currentSession! });
      expire();
      try {
        await manager.getValidSession();
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      await manager.logout();

      const consoleOutput = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
      for (const token of TOKENS) {
        expect(consoleOutput).not.toContain(token);
        expect(JSON.stringify(observed)).not.toContain(token);
        expect(errorMessage).not.toContain(token);
      }
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
    expect(errorMessage).toMatch(/session contract/);
  });
});