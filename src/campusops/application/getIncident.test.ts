import { GetIncident } from "./getIncident";
import { InMemoryIncidentRepository } from "../infrastructure/inMemoryIncidentRepository";

describe("GetIncident", () => {
  it("returns an incident by id", async () => {
    const repository = new InMemoryIncidentRepository();
    const useCase = new GetIncident(repository);

    const incident = await useCase.execute("campus-inc-001");

    expect(incident).not.toBeNull();
    expect(incident?.id).toBe("campus-inc-001");
    expect(incident?.reporterId).toBe("reporter-1");
    expect(incident?.work.assignedTechnicianId).toBe("technician-1");
    expect(incident?.work.status).toBe("assigned");
    expect(incident?.version).toBe(1);
  });

  it("returns null when the incident does not exist", async () => {
    const repository = new InMemoryIncidentRepository();
    const useCase = new GetIncident(repository);

    const incident = await useCase.execute("does-not-exist");

    expect(incident).toBeNull();
  });
});
