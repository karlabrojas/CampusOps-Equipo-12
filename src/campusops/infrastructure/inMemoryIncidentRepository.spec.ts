import { InMemoryIncidentRepository } from "../infrastructure/inMemoryIncidentRepository";

test("incident stores references instead of personal data", async () => {
  const repository = new InMemoryIncidentRepository();

  const incidents = await repository.findAll();

  for (const incident of incidents) {
    expect(incident).toHaveProperty("reporterId");

    expect(incident).not.toHaveProperty("reporterName");
    expect(incident).not.toHaveProperty("reporterEmail");
    expect(incident).not.toHaveProperty("reporterPhone");
  }
});