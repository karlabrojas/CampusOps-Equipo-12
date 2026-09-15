import { ListIncidents } from "./listIncidents";
import { InMemoryIncidentRepository } from "../infrastructure/inMemoryIncidentRepository";

describe("ListIncidents", () => {
  it("returns the list of incidents", async () => {
    const repository = new InMemoryIncidentRepository();
    const useCase = new ListIncidents(repository);

    const incidents = await useCase.execute();

    expect(incidents).toHaveLength(2);
    expect(incidents[0]?.id).toBe("campus-inc-001");
    expect(incidents[1]?.id).toBe("campus-inc-002");
  });
});
