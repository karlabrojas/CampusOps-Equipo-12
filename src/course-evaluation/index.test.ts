import { deduplicateOperations, planRetry, resolveSync } from "./index";
describe("resolveSync", () => {
  it("merges structurally equal nested values and independent changes without mutating inputs", () => {
    const base = {
      id: "incident-1",
      version: 1,
      fields: {
        work: { assignedTechnicianId: "tech-1", status: "assigned" },
        title: "Original",
      },
    };
    const local = {
      ...base,
      fields: {
        work: { status: "assigned", assignedTechnicianId: "tech-1" },
        title: "Updated locally",
      },
    };
    const remote = {
      ...base,
      version: 2,
      fields: {
        work: { assignedTechnicianId: "tech-1", status: "assigned" },
        title: "Original",
      },
    };
    const originalRecords = JSON.stringify([base, local, remote]);

    expect(resolveSync(base, local, remote)).toEqual({
      kind: "merged",
      fields: {
        work: { assignedTechnicianId: "tech-1", status: "assigned" },
        title: "Updated locally",
      },
    });
    expect(JSON.stringify([base, local, remote])).toBe(originalRecords);
  });

  it("preserves additions and deletions when the other side did not change that field", () => {
    const base = {
      id: "incident-2",
      version: 1,
      fields: { removeLocally: "old", removeRemotely: "old", unchanged: true },
    };

    expect(
      resolveSync(
        base,
        {
          ...base,
          fields: {
            removeRemotely: "old",
            unchanged: true,
            addedLocally: "new",
          },
        },
        {
          ...base,
          version: 2,
          fields: { removeLocally: "old", unchanged: true },
        },
      ),
    ).toEqual({
      kind: "merged",
      fields: { unchanged: true, addedLocally: "new" },
    });
  });

  it("reports all same-field conflicts in stable alphabetical order", () => {
    const base = {
      id: "incident-3",
      version: 1,
      fields: { status: "assigned", title: "Old", priority: 1 },
    };

    expect(
      resolveSync(
        base,
        {
          ...base,
          fields: { status: "in_progress", title: "Local", priority: 1 },
        },
        {
          ...base,
          version: 2,
          fields: { status: "closed", title: "Remote", priority: 1 },
        },
      ),
    ).toEqual({ kind: "conflict", fields: ["status", "title"] });
  });

  it("rejects records for different incidents", () => {
    const base = { id: "incident-4", version: 1, fields: {} };

    expect(() =>
      resolveSync(base, { ...base, id: "incident-5" }, base),
    ).toThrow("Cannot reconcile records with different IDs");
  });
});

describe("deduplicateOperations", () => {
  it("keeps the first operation for each ID and retains the original order", () => {
    const first = { operationId: "op-1", payload: "first" };
    const second = { operationId: "op-2", payload: "second" };
    const duplicate = { operationId: "op-1", payload: "duplicate" };

    expect(deduplicateOperations([first, second, duplicate])).toEqual([
      first,
      second,
    ]);
    expect(deduplicateOperations([first, second, duplicate])[0]).toBe(first);
  });

  it("returns an empty list for an empty queue", () => {
    expect(deduplicateOperations([])).toEqual([]);
  });
});

describe("planRetry", () => {
  it("retries a GET timeout with exponential backoff", () => {
    expect(
      planRetry({
        method: "GET",
        status: "timeout",
        attempt: 1,
      }),
    ).toEqual({
      retry: true,
      delayMs: 500,
      requiresStableIdempotencyKey: false,
    });

    expect(
      planRetry({
        method: "GET",
        status: "timeout",
        attempt: 2,
      }).delayMs,
    ).toBe(1000);

    expect(
      planRetry({
        method: "GET",
        status: "timeout",
        attempt: 3,
      }).delayMs,
    ).toBe(2000);
  });

  it("does not retry from attempt 4", () => {
    expect(
      planRetry({
        method: "GET",
        status: 503,
        attempt: 4,
      }),
    ).toEqual({
      retry: false,
      delayMs: 0,
      requiresStableIdempotencyKey: false,
    });
  });

  it("respects a valid Retry-After value", () => {
    expect(
      planRetry({
        method: "GET",
        status: 429,
        attempt: 1,
        retryAfterMs: 3000,
      }).delayMs,
    ).toBe(3000);
  });

  it("uses backoff when Retry-After is invalid", () => {
    expect(
      planRetry({
        method: "GET",
        status: 503,
        attempt: 1,
        retryAfterMs: Number.NaN,
      }).delayMs,
    ).toBe(500);
  });

  it("requires a stable idempotency key for POST", () => {
    expect(
      planRetry({
        method: "POST",
        status: "timeout",
        attempt: 1,
      }),
    ).toEqual({
      retry: false,
      delayMs: 0,
      requiresStableIdempotencyKey: true,
    });
  });

  it("allows POST retry when an idempotency key exists", () => {
    expect(
      planRetry({
        method: "POST",
        status: "timeout",
        attempt: 1,
        idempotencyKey: "operation-123",
      }),
    ).toEqual({
      retry: true,
      delayMs: 500,
      requiresStableIdempotencyKey: false,
    });
  });

  it("does not retry non-retryable HTTP errors", () => {
    expect(
      planRetry({
        method: "GET",
        status: 403,
        attempt: 1,
      }).retry,
    ).toBe(false);

    expect(
      planRetry({
        method: "GET",
        status: 404,
        attempt: 1,
      }).retry,
    ).toBe(false);
  });

  it("rejects invalid attempt numbers", () => {
    expect(
      planRetry({
        method: "GET",
        status: 503,
        attempt: 0,
      }).retry,
    ).toBe(false);

    expect(
      planRetry({
        method: "GET",
        status: 503,
        attempt: -1,
      }).retry,
    ).toBe(false);
  });
});
