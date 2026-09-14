import type { Incident, IncidentRepository } from "../contracts";

export class ListIncidents {
  constructor(private readonly repository: IncidentRepository) {}

  async execute(): Promise<readonly Incident[]> {
    return this.repository.findAll();
  }
}
