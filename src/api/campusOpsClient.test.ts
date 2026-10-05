import { CampusOpsApiError, CampusOpsClient } from "./campusOpsClient";

const remoteIncident = {
  id: "campus-inc-001",
  version: 2,
  status: "assigned",
  payload: {
    category: "connectivity",
    description: "Falla ficticia de conectividad",
    location: "Edificio de prueba A",
    reporterId: "reporter-1",
    assignedTechnicianId: "technician-1",
    priority: "high",
    notes: [],
    evidence: [],
    history: [],
  },
};

function jsonResponse(
  body: unknown,
  status = 200,
  values: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => values[name.toLowerCase()] ?? null,
    },
    json: async () => body,
  } as Response;
}

function setup(response: Response | (() => Promise<Response>)) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), ...(init === undefined ? {} : { init }) });
    return typeof response === "function" ? response() : response;
  };
  const client = new CampusOpsClient({
    baseUrl: "http://backend.test",
    getSession: () => ({
      actorId: "reporter-1",
      accessToken: "course-valid-token",
    }),
    fetcher: fetcher as typeof fetch,
    operationIdFactory: () => "create-op-0001",
  });
  return { client, calls };
}

describe("CampusOpsClient", () => {
  it("validates and maps incident list DTOs to application incidents", async () => {
    const { client, calls } = setup(jsonResponse({ items: [remoteIncident] }));

    await expect(client.findAll()).resolves.toEqual([
      {
        id: "campus-inc-001",
        version: 2,
        reporterId: "reporter-1",
        category: "connectivity",
        description: "Falla ficticia de conectividad",
        location: { source: "manual", label: "Edificio de prueba A" },
        work: { assignedTechnicianId: "technician-1", status: "assigned" },
      },
    ]);
    expect(calls[0]?.url).toBe("http://backend.test/v1/incidents");
    expect(calls[0]?.init?.headers).toMatchObject({
      Authorization: "Bearer course-valid-token",
      "X-Course-Actor": "reporter-1",
    });
  });

  it("gets a detail resource and returns null only for 404", async () => {
    const { client, calls } = setup(jsonResponse(remoteIncident));
    await expect(client.findById("campus-inc-001")).resolves.toMatchObject({
      id: "campus-inc-001",
      work: { status: "assigned" },
    });
    expect(calls[0]?.url).toBe(
      "http://backend.test/v1/incidents/campus-inc-001",
    );

    const missing = setup(jsonResponse({ code: "not_found" }, 404));
    await expect(missing.client.findById("missing")).resolves.toBeNull();
  });

  it("creates an incident with a stable idempotency key and maps its response", async () => {
    const { client, calls } = setup(
      jsonResponse(
        {
          incident: { ...remoteIncident, id: "campus-inc-101", status: "open" },
          operationId: "create-op-0001",
          duplicate: false,
        },
        201,
      ),
    );

    const result = await client.createIncident({
      category: "connectivity",
      description: "Falla ficticia de conectividad",
      location: "Edificio de prueba A",
    });

    expect(result).toMatchObject({
      incident: { id: "campus-inc-101", work: { status: "open" } },
      operationId: "create-op-0001",
      duplicate: false,
    });
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({
      "Content-Type": "application/json",
      "Idempotency-Key": "create-op-0001",
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      category: "connectivity",
      description: "Falla ficticia de conectividad",
      location: "Edificio de prueba A",
    });
  });

  it("preserves the generated key on an uncertain creation for an exact retry", async () => {
    let attempts = 0;
    const { client, calls } = setup(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("connection lost after commit");
      return jsonResponse({
        incident: { ...remoteIncident, id: "campus-inc-101" },
        operationId: "create-op-0001",
        duplicate: true,
      });
    });
    const input = {
      category: "connectivity" as const,
      description: "Falla ficticia de conectividad",
      location: "Edificio de prueba A",
    };

    const firstError = await client
      .createIncident(input)
      .catch((error: unknown) => error);
    expect(firstError).toMatchObject({
      kind: "network",
      operationId: "create-op-0001",
    });
    if (!(firstError instanceof CampusOpsApiError) || !firstError.operationId) {
      throw new Error(
        "Expected the failed operation id to be available for retry",
      );
    }

    await expect(
      client.createIncident(input, firstError.operationId),
    ).resolves.toMatchObject({
      operationId: "create-op-0001",
      duplicate: true,
    });
    expect(
      calls.map(
        ({ init }) =>
          (init?.headers as Record<string, string>)["Idempotency-Key"],
      ),
    ).toEqual(["create-op-0001", "create-op-0001"]);
  });

  it("rejects null payloads and malformed domain data before exposing them", async () => {
    const nullable = setup(
      jsonResponse({
        items: [{ ...remoteIncident, payload: null }],
      }),
    );
    await expect(nullable.client.findAll()).rejects.toMatchObject<
      Partial<CampusOpsApiError>
    >({
      kind: "domain",
    });

    const invalid = setup(
      jsonResponse({
        items: [
          {
            ...remoteIncident,
            payload: { ...remoteIncident.payload, category: "unknown" },
          },
        ],
      }),
    );
    await expect(invalid.client.findAll()).rejects.toMatchObject<
      Partial<CampusOpsApiError>
    >({
      kind: "domain",
    });
  });

  it("maps HTTP and network failures without exposing raw response data", async () => {
    const rateLimited = setup(
      jsonResponse({ code: "rate_limited", detail: "private text" }, 429, {
        "retry-after": "1",
      }),
    );
    await expect(rateLimited.client.findAll()).rejects.toMatchObject({
      kind: "http",
      status: 429,
      code: "rate_limited",
      retryAfterMs: 1000,
    });
    await expect(rateLimited.client.findAll()).rejects.not.toThrow(
      "private text",
    );

    const offline = setup(async () => {
      throw new Error("Bearer sensitive-token");
    });
    await expect(offline.client.findAll()).rejects.toMatchObject({
      kind: "network",
    });
    await expect(offline.client.findAll()).rejects.not.toThrow(
      "sensitive-token",
    );
  });

  it("does not make a request without a valid session", async () => {
    const fetcher = jest.fn();
    const client = new CampusOpsClient({
      getSession: () => null,
      fetcher: fetcher as typeof fetch,
    });

    await expect(client.findAll()).rejects.toMatchObject({ kind: "session" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("distinguishes backend timeouts from network failures", async () => {
    const fetcher = jest.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          });
        }),
    );

    const client = new CampusOpsClient({
      baseUrl: "http://backend.test",
      getSession: () => ({
        actorId: "reporter-1",
        accessToken: "course-valid-token",
      }),
      fetcher: fetcher as typeof fetch,
      operationIdFactory: () => "create-op-0001",
    });

    await expect(client.findAll()).rejects.toMatchObject({
      kind: "timeout",
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
