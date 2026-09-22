import { GetIncident } from "../application/getIncident";
import { InMemoryIncidentRepository } from "../infrastructure/inMemoryIncidentRepository";

// T-01 - Consultar incidencias ajenas.
// campus-inc-001: reportada por reporter-1 y asignada a technician-1.
// campus-inc-002: reportada por reporter-2 y sin tecnico asignado.
function useCase() {
  return new GetIncident(new InMemoryIncidentRepository());
}

describe("T-01 consultar incidencias ajenas", () => {
  it("nominal: el reportante ve su propia incidencia", async () => {
    const incident = await useCase().execute("campus-inc-001", "reporter-1");
    expect(incident?.id).toBe("campus-inc-001");
  });

  it("nominal: el tecnico ve la incidencia que tiene asignada", async () => {
    const incident = await useCase().execute("campus-inc-001", "technician-1");
    expect(incident?.id).toBe("campus-inc-001");
  });

  it("nominal: el coordinador ve cualquier incidencia", async () => {
    const incident = await useCase().execute("campus-inc-002", "coordinator-1");
    expect(incident?.id).toBe("campus-inc-002");
  });

  it("failure: un reportante no puede ver la incidencia de otro reportante", async () => {
    const incident = await useCase().execute("campus-inc-001", "reporter-2");
    expect(incident).toBeNull();
  });

  it("failure: un tecnico no puede ver una incidencia que no tiene asignada", async () => {
    const incident = await useCase().execute("campus-inc-001", "technician-2");
    expect(incident).toBeNull();
  });

  it("boundary: un actor desconocido es rechazado", async () => {
    await expect(useCase().execute("campus-inc-001", "intruder-9")).rejects.toThrow(/forbidden/);
  });

  it("boundary: nombres especiales de objeto no se aceptan como actor", async () => {
    await expect(useCase().execute("campus-inc-001", "constructor")).rejects.toThrow(/forbidden/);
    await expect(useCase().execute("campus-inc-001", "__proto__")).rejects.toThrow(/forbidden/);
  });
});