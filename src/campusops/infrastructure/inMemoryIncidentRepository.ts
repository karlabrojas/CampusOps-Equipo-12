import type { Incident, IncidentRepository } from "../contracts";

const SYNTHETIC_INCIDENTS: readonly Incident[] = [
  {
    id: "campus-inc-001",
    reporterId: "reporter-1",
    category: "electrical",
    description: "Falla eléctrica en un laboratorio de prueba.",
    location: {
      source: "manual",
      label: "Laboratorio A-101",
    },
    work: {
      assignedTechnicianId: "technician-1",
      status: "assigned",
    },
    version: 1,
  },
  {
    id: "campus-inc-002",
    reporterId: "reporter-2",
    category: "connectivity",
    description: "Conectividad intermitente en una zona de prueba.",
    location: {
      source: "manual",
      label: "Edificio B-202",
    },
    work: {
      assignedTechnicianId: null,
      status: "open",
    },
    version: 1,
  },
];

export class InMemoryIncidentRepository implements IncidentRepository {
  async findAll(): Promise<readonly Incident[]> {
    return SYNTHETIC_INCIDENTS;
  }

  async findById(id: string): Promise<Incident | null> {
    return SYNTHETIC_INCIDENTS.find((incident) => incident.id === id) ?? null;
  }
}
