import type { Incident, IncidentRepository } from "../contracts";

type ActorRole = "reporter" | "technician" | "coordinator";

function resolveRole(actorId: string): ActorRole | null {
  if (/^reporter-/.test(actorId)) return "reporter";
  if (/^technician-/.test(actorId)) return "technician";
  if (/^coordinator-/.test(actorId)) return "coordinator";
  return null;
}

export class GetIncident {
  constructor(private readonly repository: IncidentRepository) {}

  async execute(id: string, actorId: string): Promise<Incident | null> {
    const role = resolveRole(actorId);
    if (!role) {
      throw new Error("forbidden: unknown actor");
    }

    const incident = await this.repository.findById(id);
    if (!incident) {
      return null;
    }

    if (role === "coordinator") {
      return incident;
    }
    if (role === "reporter") {
      return incident.reporterId === actorId ? incident : null;
    }
    return incident.work.assignedTechnicianId === actorId ? incident : null;
  }
}
