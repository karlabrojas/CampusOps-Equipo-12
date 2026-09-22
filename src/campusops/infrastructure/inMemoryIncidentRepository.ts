import type { Incident, IncidentRepository } from "../contracts";

const SYNTHETIC_INCIDENTS: readonly Incident[] = [
  {
    id: "campus-inc-001",
    reporterId: "reporter-1",
    category: "electrical",
    description: "Falla el\u00e9ctrica en un laboratorio de prueba.",
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
  // Cada instancia trabaja con su propia copia: las pruebas no se contaminan entre si.
  private incidents: Incident[] = SYNTHETIC_INCIDENTS.map((incident) => ({ ...incident }));

  async findAll(): Promise<readonly Incident[]> {
    return this.incidents;
  }

  async findById(id: string): Promise<Incident | null> {
    return this.incidents.find((incident) => incident.id === id) ?? null;
  }

  async save(incident: Incident): Promise<void> {
    this.incidents = this.incidents.map((current) =>
      current.id === incident.id ? incident : current,
    );
  }
}