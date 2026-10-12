import {
  CloseIncident,
  ReopenIncident,
  ResolveIncident,
} from "../application/incidentTransitions";
import { InMemoryIncidentRepository } from "../infrastructure/inMemoryIncidentRepository";

// T-06 - Autorizacion por rol en las operaciones (no solo en la UI).
// campus-inc-001: reporter-1, asignada a technician-1, status "assigned", version 1.
// campus-inc-002: reporter-2, sin tecnico, status "open", version 1.
function setup() {
  const store = new InMemoryIncidentRepository();
  return {
    store,
    resolve: new ResolveIncident(store),
    close: new CloseIncident(store),
    reopen: new ReopenIncident(store),
  };
}

const base = { incidentId: "campus-inc-001", baseVersion: 1 };

async function resolved() {
  const ctx = setup();
  await ctx.resolve.execute({ ...base, actorId: "technician-1" });
  return ctx;
}

describe("T-06 autorizacion positiva", () => {
  it("nominal: el tecnico asignado resuelve su incidencia", async () => {
    const { store, resolve } = setup();
    const updated = await resolve.execute({ ...base, actorId: "technician-1" });
    expect(updated.work.status).toBe("resolved");
    expect(updated.version).toBe(2);
    expect((await store.findById("campus-inc-001"))?.work.status).toBe("resolved");
  });

  it("nominal: coordinacion cierra una incidencia resuelta", async () => {
    const { store, close } = await resolved();
    const updated = await close.execute({ ...base, baseVersion: 2, actorId: "coordinator-1" });
    expect(updated.work.status).toBe("closed");
    expect((await store.findById("campus-inc-001"))?.version).toBe(3);
  });

  it("nominal: coordinacion reabre una incidencia cerrada y conserva al tecnico", async () => {
    const { store, close, reopen } = await resolved();
    await close.execute({ ...base, baseVersion: 2, actorId: "coordinator-1" });
    const updated = await reopen.execute({ ...base, baseVersion: 3, actorId: "coordinator-1" });
    expect(updated.work.status).toBe("assigned");
    expect(updated.work.assignedTechnicianId).toBe("technician-1");
    expect((await store.findById("campus-inc-001"))?.version).toBe(4);
  });

  it("nominal: coordinacion reabre una incidencia resuelta", async () => {
    const { reopen } = await resolved();
    const updated = await reopen.execute({ ...base, baseVersion: 2, actorId: "coordinator-1" });
    expect(updated.work.status).toBe("assigned");
  });
});

describe("T-06 autorizacion negativa (ejecucion directa, sin UI)", () => {
  it("failure: un tecnico NO asignado no puede resolver y nada cambia", async () => {
    const { store, resolve } = setup();
    await expect(resolve.execute({ ...base, actorId: "technician-2" })).rejects.toThrow(/forbidden/);
    const stored = await store.findById("campus-inc-001");
    expect(stored?.work.status).toBe("assigned");
    expect(stored?.version).toBe(1);
  });

  it("failure: un reportante no puede resolver ni siquiera su propia incidencia", async () => {
    const { store, resolve } = setup();
    await expect(resolve.execute({ ...base, actorId: "reporter-1" })).rejects.toThrow(/forbidden/);
    expect((await store.findById("campus-inc-001"))?.version).toBe(1);
  });

  it("failure: un reportante no puede cerrar ni reabrir", async () => {
    const { store, close, reopen } = await resolved();
    await expect(close.execute({ ...base, baseVersion: 2, actorId: "reporter-1" })).rejects.toThrow(/forbidden/);
    await expect(reopen.execute({ ...base, baseVersion: 2, actorId: "reporter-1" })).rejects.toThrow(/forbidden/);
    const stored = await store.findById("campus-inc-001");
    expect(stored?.work.status).toBe("resolved");
    expect(stored?.version).toBe(2);
  });

  it("failure: un tecnico (aunque este asignado) no puede cerrar ni reabrir", async () => {
    const { store, close, reopen } = await resolved();
    await expect(close.execute({ ...base, baseVersion: 2, actorId: "technician-1" })).rejects.toThrow(/forbidden/);
    await expect(reopen.execute({ ...base, baseVersion: 2, actorId: "technician-1" })).rejects.toThrow(/forbidden/);
    expect((await store.findById("campus-inc-001"))?.work.status).toBe("resolved");
  });

  it("boundary: un actor desconocido es rechazado en las tres operaciones", async () => {
    const { store, resolve, close, reopen } = setup();
    for (const useCase of [resolve, close, reopen]) {
      await expect(useCase.execute({ ...base, actorId: "intruder-9" })).rejects.toThrow(/forbidden/);
    }
    expect((await store.findById("campus-inc-001"))?.version).toBe(1);
  });

  it("boundary: coordinacion no puede cerrar una incidencia que no esta resuelta", async () => {
    const { store, close } = setup();
    await expect(close.execute({ ...base, actorId: "coordinator-1" })).rejects.toThrow(/invalid-state/);
    expect((await store.findById("campus-inc-001"))?.work.status).toBe("assigned");
  });

  it("boundary: no se puede reabrir una incidencia sin tecnico asignado", async () => {
    const { store, reopen } = setup();
    const inc = await store.findById("campus-inc-002");
    await store.save({ ...inc!, work: { assignedTechnicianId: null, status: "closed" } });
    await expect(
      reopen.execute({ incidentId: "campus-inc-002", baseVersion: 1, actorId: "coordinator-1" }),
    ).rejects.toThrow(/invalid-state/);
    expect((await store.findById("campus-inc-002"))?.work.status).toBe("closed");
  });

  it("boundary: una version base obsoleta se rechaza sin modificar la incidencia", async () => {
    const { store, resolve } = setup();
    await expect(resolve.execute({ ...base, baseVersion: 0, actorId: "technician-1" })).rejects.toThrow(/conflict/);
    expect((await store.findById("campus-inc-001"))?.version).toBe(1);
  });

  it("boundary: una incidencia inexistente devuelve not-found", async () => {
    const { resolve } = setup();
    await expect(
      resolve.execute({ incidentId: "campus-inc-999", baseVersion: 1, actorId: "technician-1" }),
    ).rejects.toThrow(/not-found/);
  });

  it("failure: resolver dos veces la misma incidencia se rechaza", async () => {
    const { resolve } = await resolved();
    await expect(resolve.execute({ ...base, baseVersion: 2, actorId: "technician-1" })).rejects.toThrow(/invalid-state/);
  });
});