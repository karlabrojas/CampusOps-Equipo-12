import { coordinateRefresh } from "./index";

function simulateSuccessfulRefreshScenario() {
  const events = [
    { type: "request401", requestId: "A", generation: 0 },
    { type: "request401", requestId: "B", generation: 0 },
    { type: "request401", requestId: "C", generation: 0 },
    { type: "refreshSucceeded", generation: 1, token: "token-renovado-1" },
  ] as const;

  const logs = [
    "[A] REQUEST",
    "[B] REQUEST",
    "[C] REQUEST",
    "",
    "[A] 401",
    "[B] 401",
    "[C] 401",
    "",
    "[AUTH] REFRESH START",
    "[AUTH] REFRESH SUCCESS",
    "",
    "[A] RETRY -> OK",
    "[B] RETRY -> OK",
    "[C] RETRY -> OK",
  ];

  return { events, logs, result: coordinateRefresh(events) };
}

function simulateFailedRefreshScenario() {
  const events = [
    { type: "request401", requestId: "A", generation: 0 },
    { type: "request401", requestId: "B", generation: 0 },
    { type: "request401", requestId: "C", generation: 0 },
    { type: "refreshFailed", generation: 0 },
  ] as const;

  const logs = [
    "[A] REQUEST",
    "[B] REQUEST",
    "[C] REQUEST",
    "",
    "[A] 401",
    "[B] 401",
    "[C] 401",
    "",
    "[AUTH] REFRESH START",
    "[AUTH] REFRESH FAIL -> 401",
    "",
    "accessToken = null",
    "refreshToken = null",
    "status = anonymous",
    "redirigir a login",
  ];

  return { events, logs, result: coordinateRefresh(events) };
}

describe("sesion segura con tres peticiones concurrentes", () => {
  test("simula caso exitoso con un solo refresh y reintentos de A, B y C", () => {
    const { result, logs } = simulateSuccessfulRefreshScenario();

    expect(result.status).toBe("authenticated");
    expect(result.refreshCalls).toBe(1);
    expect(result.retriedRequestIds).toEqual(["A", "B", "C"]);
    expect(result.persistedToken).toBe("token-renovado-1");

    expect(logs).toContain("[A] 401");
    expect(logs).toContain("[B] 401");
    expect(logs).toContain("[C] 401");
    expect(logs).toContain("[AUTH] REFRESH START");
    expect(logs).toContain("[AUTH] REFRESH SUCCESS");
    expect(logs).toContain("[A] RETRY -> OK");
    expect(logs).toContain("[B] RETRY -> OK");
    expect(logs).toContain("[C] RETRY -> OK");
  });

  test("simula caso fallido con limpieza segura de la sesion", () => {
    const { result, logs } = simulateFailedRefreshScenario();

    expect(result.status).toBe("anonymous");
    expect(result.refreshCalls).toBe(1);
    expect(result.activeGeneration).toBeNull();
    expect(result.persistedToken).toBeNull();

    expect(logs).toContain("[AUTH] REFRESH FAIL -> 401");
    expect(logs).toContain("accessToken = null");
    expect(logs).toContain("refreshToken = null");
    expect(logs).toContain("status = anonymous");
    expect(logs).toContain("redirigir a login");
  });
});
