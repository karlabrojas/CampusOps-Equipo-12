import { deduplicateOperations, resolveSync } from "./index";

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
        { ...base, fields: { removeRemotely: "old", unchanged: true, addedLocally: "new" } },
        { ...base, version: 2, fields: { removeLocally: "old", unchanged: true } },
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
        { ...base, fields: { status: "in_progress", title: "Local", priority: 1 } },
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
