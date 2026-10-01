import {
  BackendError,
  classifyHttpResponse,
  fetchWithTimeout,
  isBackendError,
} from "./backendErrors";

describe("backend error handling", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("distinguishes an HTTP 500 response", () => {
    const response = new Response(
      JSON.stringify({ code: "controlled_failure" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );

    expect(() => classifyHttpResponse(response)).toThrow(BackendError);

    try {
      classifyHttpResponse(response);
    } catch (error) {
      expect(isBackendError(error)).toBe(true);
      expect(error).toMatchObject({
        kind: "http",
        status: 500,
      });
    }
  });

  it("accepts a successful response", () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
    });

    expect(() => classifyHttpResponse(response)).not.toThrow();
  });

  it("distinguishes a timeout", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(
        new DOMException("The operation was aborted", "AbortError"),
      );

    await expect(
      fetchWithTimeout("http://127.0.0.1:4310/health", {}, 10),
    ).rejects.toMatchObject({
      kind: "timeout",
    });
  });

  it("distinguishes an unexpected network failure", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("connection refused"));

    await expect(
      fetchWithTimeout("http://127.0.0.1:4310/health"),
    ).rejects.toMatchObject({
      kind: "network",
    });
  });
});
