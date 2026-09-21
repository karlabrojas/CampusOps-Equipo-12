import type { Incident, IncidentRepository } from "../contracts";

export interface IncidentStore extends IncidentRepository {
  save(incident: Incident): Promise<void>;
}

export type AssignIncidentCommand = Readonly<{
  actorId: string;
  incidentId: string;
  technicianId: string;
  baseVersion: number;
}>;

function isCoordinator(actorId: string): boolean {
  return /^coordinator-/.test(actorId);
}

export class AssignIncident {
  constructor(private readonly store: IncidentStore) {}

  async execute(command: AssignIncidentCommand): Promise<Incident> {
    if (!isCoordinator(command.actorId)) {
      throw new Error("forbidden: actor cannot assign incidents");
    }

    const incident = await this.store.findById(command.incidentId);
    if (!incident) {
      throw new Error("not-found: incident does not exist");
    }
    if (incident.version !== command.baseVersion) {
      throw new Error("conflict: incident version changed");
    }

    const updated: Incident = {
      ...incident,
      work: { assignedTechnicianId: command.technicianId, status: "assigned" },
      version: incident.version + 1,
    };
    await this.store.save(updated);
    return updated;
  }
}
