import { CampusOpsClient } from "./campusOpsClient";

const FALLA_REFRESH = process.env.FALLA_REFRESH === "1";

const remoteIncident = {
  id: "inc-1",
  version: 1,
  status: "open",
  payload: {
    category: "water",
    description: "Fuga de prueba",
    location: "Edificio de prueba",
    reporterId: "actor-prueba",
    assignedTechnicianId: null,
    priority: "normal",
    notes: [],
    evidence: [],
    history: [],
  },
};

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

describe("Semana 6: renovación de sesión concurrente", () => {
  it("comparte una sola renovación entre tres peticiones", async () => {
    let session: {
      actorId: string;
      accessToken: string;
    } | null = {
      actorId: "actor-prueba",
      accessToken: "token-vencido",
    };

    let fetchCalls = 0;
    let initial401 = 0;
    let refreshCalls = 0;
    let clearCalls = 0;
    let newTokenCalls = 0;

    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });

    let notifyAll401!: () => void;
    const all401Gate = new Promise<void>((resolve) => {
      notifyAll401 = resolve;
    });

    let notifyRefreshStarted!: () => void;
    const refreshStartedGate = new Promise<void>((resolve) => {
      notifyRefreshStarted = resolve;
    });

    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls++;

      const headers = init?.headers as Record<string, string>;
      const auth = headers.Authorization;
      const method = init?.method ?? "GET";
      const path = String(url).replace("http://test.local", "");

      if (auth === "Bearer token-vencido") {
        initial401++;

        if (initial401 === 3) {
          notifyAll401();
        }

        return fakeResponse(401, { code: "token_expired" });
      }

      if (auth === "Bearer token-nuevo") {
        newTokenCalls++;
      }

      if (method === "POST") {
        return fakeResponse(201, {
          incident: remoteIncident,
          operationId: "incident-create-prueba-1",
          duplicate: false,
        });
      }

      if (path === "/v1/incidents") {
        return fakeResponse(200, { items: [remoteIncident] });
      }

      if (path === "/v1/incidents/inc-1") {
        return fakeResponse(200, remoteIncident);
      }

      return fakeResponse(404, { code: "not_found" });
    }) as typeof fetch;

    const client = new CampusOpsClient({
      baseUrl: "http://test.local",
      fetcher,
      getSession: () => session,
      operationIdFactory: () => "incident-create-prueba-1",
      refreshSession: async () => {
        refreshCalls++;
        notifyRefreshStarted();

        await refreshGate;

        if (FALLA_REFRESH) {
          throw new Error("refresh rechazado");
        }

        session = {
          actorId: "actor-prueba",
          accessToken: "token-nuevo",
        };

        return "token-nuevo";
      },
      clearSession: () => {
        clearCalls++;
        session = null;
      },
    });

    const requests = [
      client.findAll(),
      client.findById("inc-1"),
      client.createIncident({
        category: "water",
        description: "Fuga de prueba",
        location: "Edificio de prueba",
      }),
    ];

    const resultsPromise = Promise.allSettled(requests);

    // No liberamos el refresh hasta que las tres peticiones
    // hayan recibido 401 y la renovación haya comenzado.
    await Promise.all([all401Gate, refreshStartedGate]);

    expect(initial401).toBe(3);
    expect(refreshCalls).toBe(1);

    releaseRefresh();

    const results = await resultsPromise;

    if (FALLA_REFRESH) {
      expect(results.every((r) => r.status === "rejected")).toBe(true);
      expect(refreshCalls).toBe(1);
      expect(fetchCalls).toBe(3);
      expect(newTokenCalls).toBe(0);
      expect(clearCalls).toBe(1);
      expect(session).toBeNull();
    } else {
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      expect(refreshCalls).toBe(1);
      expect(fetchCalls).toBe(6);
      expect(newTokenCalls).toBe(3);
      expect(clearCalls).toBe(0);
      expect(session?.accessToken).toBe("token-nuevo");
    }
  });
});
