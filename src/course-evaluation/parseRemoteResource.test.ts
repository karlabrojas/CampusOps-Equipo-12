import { parseRemoteResource } from "./index";

describe("parseRemoteResource", () => {
  it("accepts a valid remote resource", () => {
    const input = {
      id: "campus-inc-001",
      version: 2,
      status: "assigned",
      payload: {
        category: "connectivity",
        description: "Falla ficticia",
      },
    };

    const result = parseRemoteResource(input);

    expect(result).toEqual({
      ok: true,
      value: {
        id: "campus-inc-001",
        version: 2,
        status: "assigned",
        payload: {
          category: "connectivity",
          description: "Falla ficticia",
        },
      },
    });
  });

  it("accepts a valid null payload", () => {
    const result = parseRemoteResource({
      id: "campus-inc-002",
      version: 0,
      status: "closed",
      payload: null,
    });

    expect(result.ok).toBe(true);
  });

  it("accepts future fields without changing the contract", () => {
    const result = parseRemoteResource({
      id: "campus-inc-003",
      version: 1,
      status: "open",
      payload: null,
      futureField: "ignored",
    });

    expect(result.ok).toBe(true);
  });

  it.each([
    null,
    [],
    "invalid",
    123,
    { id: "", version: 1, status: "open", payload: null },
    { id: "r-1", version: -1, status: "open", payload: null },
    { id: "r-1", version: 1.5, status: "open", payload: null },
    { id: "r-1", version: 1, status: "", payload: null },
    { id: "r-1", version: 1, status: "open", payload: "invalid" },
    { id: "r-1", version: 1, status: "open", payload: [] },
  ])("rejects malformed payload %#", (input) => {
    expect(parseRemoteResource(input).ok).toBe(false);
  });

  it("does not mutate the original input", () => {
    const input = {
      id: "campus-inc-004",
      version: 3,
      status: "assigned",
      payload: {
        category: "equipment",
      },
      futureField: true,
    };

    const original = structuredClone(input);

    parseRemoteResource(input);

    expect(input).toEqual(original);
  });

  it("rejects a malformed remote resource instead of using it as domain data", () => {
    const malformedPayload: unknown = {
      id: "r-malformed",
      version: "1",
      status: "open",
      payload: {
        category: "connectivity",
      },
    };

    const result = parseRemoteResource(malformedPayload);

    expect(result).toEqual({
      ok: false,
      error: "contract",
    });
  });
});
