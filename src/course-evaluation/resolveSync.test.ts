import { resolveSync } from "./index";
import type { SyncRecord } from "./contracts";

const base: SyncRecord = {
  id: "incident-1",
  version: 1,
  fields: {
    description: "Falla inicial",
    status: "open",
    category: "connectivity",
  },
};

describe("resolveSync", () => {
  it("combines independent local and remote changes", () => {
    const local: SyncRecord = {
      ...base,
      version: 2,
      fields: {
        ...base.fields,
        description: "Descripción actualizada localmente",
      },
    };

    const remote: SyncRecord = {
      ...base,
      version: 2,
      fields: {
        ...base.fields,
        status: "assigned",
      },
    };

    expect(resolveSync(base, local, remote)).toEqual({
      kind: "merged",
      fields: {
        description: "Descripción actualizada localmente",
        status: "assigned",
        category: "connectivity",
      },
    });
  });

  it("reports a conflict when both sides change the same field differently", () => {
    const local: SyncRecord = {
      ...base,
      fields: { ...base.fields, description: "Cambio local" },
    };

    const remote: SyncRecord = {
      ...base,
      fields: { ...base.fields, description: "Cambio remoto" },
    };

    expect(resolveSync(base, local, remote)).toEqual({
      kind: "conflict",
      fields: ["description"],
    });
  });

  it("does not report a conflict when both sides choose the same value", () => {
    const local: SyncRecord = {
      ...base,
      fields: { ...base.fields, status: "assigned" },
    };

    const remote: SyncRecord = {
      ...base,
      fields: { ...base.fields, status: "assigned" },
    };

    expect(resolveSync(base, local, remote)).toEqual({
      kind: "merged",
      fields: {
        ...base.fields,
        status: "assigned",
      },
    });
  });

  it("compares nested JSON objects by content, not identity", () => {
    const original: SyncRecord = {
      ...base,
      fields: { details: { city: "Puebla", priority: 1 } },
    };

    const local: SyncRecord = {
      ...original,
      fields: { details: { city: "Puebla", priority: 1 } },
    };

    const remote: SyncRecord = {
      ...original,
      fields: { details: { city: "Puebla", priority: 1 } },
    };

    expect(resolveSync(original, local, remote)).toEqual({
      kind: "merged",
      fields: { details: { city: "Puebla", priority: 1 } },
    });
  });

  it("returns multiple conflicting fields in alphabetical order", () => {
    const local: SyncRecord = {
      ...base,
      fields: {
        ...base.fields,
        status: "assigned",
        description: "Local",
      },
    };

    const remote: SyncRecord = {
      ...base,
      fields: {
        ...base.fields,
        status: "closed",
        description: "Remoto",
      },
    };

    expect(resolveSync(base, local, remote)).toEqual({
      kind: "conflict",
      fields: ["description", "status"],
    });
  });

  it("preserves a local deletion when the remote field is unchanged", () => {
    const original: SyncRecord = {
      ...base,
      fields: { description: "Falla", category: "connectivity" },
    };

    const local: SyncRecord = {
      ...original,
      fields: { category: "connectivity" },
    };

    const remote: SyncRecord = {
      ...original,
      fields: { description: "Falla", category: "connectivity" },
    };

    expect(resolveSync(original, local, remote)).toEqual({
      kind: "merged",
      fields: { category: "connectivity" },
    });
  });

  it("reports a conflict when one side deletes a field and the other changes it", () => {
    const original: SyncRecord = {
      ...base,
      fields: { description: "Falla" },
    };

    const local: SyncRecord = {
      ...original,
      fields: {},
    };

    const remote: SyncRecord = {
      ...original,
      fields: { description: "Falla actualizada" },
    };

    expect(resolveSync(original, local, remote)).toEqual({
      kind: "conflict",
      fields: ["description"],
    });
  });

  it("does not mutate the input records", () => {
    const local: SyncRecord = {
      ...base,
      fields: { ...base.fields, description: "Local" },
    };

    const remote: SyncRecord = {
      ...base,
      fields: { ...base.fields, status: "assigned" },
    };

    const originalBase = structuredClone(base);
    const originalLocal = structuredClone(local);
    const originalRemote = structuredClone(remote);

    resolveSync(base, local, remote);

    expect(base).toEqual(originalBase);
    expect(local).toEqual(originalLocal);
    expect(remote).toEqual(originalRemote);
  });

  it("detects a conflict when coordination reassigns an incident while a technician starts offline", () => {
    const original: SyncRecord = {
      id: "campus-inc-001",
      version: 1,
      fields: {
        description: "Falla de conectividad",
        work: {
          assignedTechnicianId: "technician-1",
          status: "assigned",
        },
      },
    };

    const local: SyncRecord = {
      ...original,
      version: 2,
      fields: {
        ...original.fields,
        work: {
          assignedTechnicianId: "technician-1",
          status: "in_progress",
        },
      },
    };

    const remote: SyncRecord = {
      ...original,
      version: 2,
      fields: {
        ...original.fields,
        work: {
          assignedTechnicianId: "technician-2",
          status: "assigned",
        },
      },
    };

    expect(resolveSync(original, local, remote)).toEqual({
      kind: "conflict",
      fields: ["work"],
    });

    // El estado remoto conserva la reasignación y las entradas no se mutan.
    expect(remote.fields.work).toEqual({
      assignedTechnicianId: "technician-2",
      status: "assigned",
    });
    expect(local.fields.work).toEqual({
      assignedTechnicianId: "technician-1",
      status: "in_progress",
    });
  });

  it("merges independent changes while preserving the remote reassignment", () => {
    const original: SyncRecord = {
      id: "campus-inc-001",
      version: 1,
      fields: {
        description: "Falla inicial",
        work: {
          assignedTechnicianId: "technician-1",
          status: "assigned",
        },
      },
    };

    const local: SyncRecord = {
      ...original,
      version: 2,
      fields: {
        ...original.fields,
        description: "Falla descrita con más detalle",
      },
    };

    const remote: SyncRecord = {
      ...original,
      version: 2,
      fields: {
        ...original.fields,
        work: {
          assignedTechnicianId: "technician-2",
          status: "assigned",
        },
      },
    };

    expect(resolveSync(original, local, remote)).toEqual({
      kind: "merged",
      fields: {
        description: "Falla descrita con más detalle",
        work: {
          assignedTechnicianId: "technician-2",
          status: "assigned",
        },
      },
    });
  });
});
