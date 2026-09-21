import type { Incident, IncidentRepository } from "../contracts";

export class GetIncident {
  constructor(private readonly repository: IncidentRepository) {}

  // T-01: el actor se recibe pero todavia no se comprueba su autorizacion.
  async execute(id: string, _actorId: string): Promise<Incident | null> {
    return this.repository.findById(id);
  }
}