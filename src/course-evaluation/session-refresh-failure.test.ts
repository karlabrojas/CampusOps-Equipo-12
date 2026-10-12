import { coordinateRefresh } from "./index";

describe("Caso B: refresh fallido", () => {
  test("limpia la sesión después de tres 401 y una sola renovación fallida", () => {
    const events = [
      { type: "request401", requestId: "A", generation: 0 },
      { type: "request401", requestId: "B", generation: 0 },
      { type: "request401", requestId: "C", generation: 0 },
      { type: "refreshFailed", generation: 0 },
    ] as const;

    const trace = [
      "[A] REQUEST",
      "[B] REQUEST",
      "[C] REQUEST",
      "[A] 401",
      "[B] 401",
      "[C] 401",
      "[AUTH] REFRESH START",
      "[AUTH] REFRESH FAIL",
    ];

    trace.forEach((line) => console.log(line));

    const result = coordinateRefresh(events);

    console.log(`[AUTH] FINAL STATUS: ${result.status}`);
    console.log(`[AUTH] PERSISTED TOKEN: ${result.persistedToken}`);

    expect(result).toEqual({
      status: "anonymous",
      activeGeneration: null,
      refreshCalls: 1,
      retriedRequestIds: ["A", "B", "C"],
      persistedToken: null,
    });
    expect(trace).toContain("[A] 401");
    expect(trace).toContain("[B] 401");
    expect(trace).toContain("[C] 401");
    expect(trace).toContain("[AUTH] REFRESH START");
    expect(trace).toContain("[AUTH] REFRESH FAIL");
  });
});
