import { AssignIncident } from "../application/assignIncident";
import { InMemoryIncidentRepository } from "../infrastructure/inMemoryIncidentRepository";

// T-02 - Alterar asignaciones.
// campus-inc-002 empieza sin tecnico asignado y con version 1.
function setup() {
  const store = new InMemoryIncidentRepository();
  return { store, useCase: new AssignIncident(store) };
}

const command = {
  incidentId: "campus-inc-002",
  technicianId: "technician-2",
  baseVersion: 1,
};

describe("T-02 alterar asignaciones", () => {
  it("nominal: el coordinador asigna un tecnico y aumenta la version", async () => {
    const { store, useCase } = setup();
    const updated = await useCase.execute({ ...command, actorId: "coordinator-1" });
    expect(updated.work.assignedTechnicianId).toBe("technician-2");
    expect(updated.version).toBe(2);
    expect((await store.findById("campus-inc-002"))?.work.assignedTechnicianId).toBe("technician-2");
  });

  it("failure: un reportante no puede asignar y la asignacion no cambia", async () => {
    const { store, useCase } = setup();
    await expect(useCase.execute({ ...command, actorId: "reporter-2" })).rejects.toThrow(/forbidden/);
    const stored = await store.findById("campus-inc-002");
    expect(stored?.work.assignedTechnicianId).toBeNull();
    expect(stored?.version).toBe(1);
  });

  it("failure: un tecnico no puede autoasignarse y la asignacion no cambia", async () => {
    const { store, useCase } = setup();
    await expect(useCase.execute({ ...command, actorId: "technician-2" })).rejects.toThrow(/forbidden/);
    expect((await store.findById("campus-inc-002"))?.work.assignedTechnicianId).toBeNull();
  });

  it("boundary: un actor desconocido es rechazado", async () => {
    const { store, useCase } = setup();
    await expect(useCase.execute({ ...command, actorId: "intruder-9" })).rejects.toThrow(/forbidden/);
    expect((await store.findById("campus-inc-002"))?.version).toBe(1);
  });

  it("boundary: una version base desactualizada se rechaza sin modificar la incidencia", async () => {
    const { store, useCase } = setup();
    await expect(
      useCase.execute({ ...command, actorId: "coordinator-1", baseVersion: 0 }),
    ).rejects.toThrow(/conflict/);
    expect((await store.findById("campus-inc-002"))?.version).toBe(1);
  });
});