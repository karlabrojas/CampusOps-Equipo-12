import type { Incident, IncidentRepository } from "../contracts";

export class GetIncident {
  constructor(private readonly repository: IncidentRepository) {}

  async execute(id: string): Promise<Incident | null> {
    return this.repository.findById(id);
  }
}
