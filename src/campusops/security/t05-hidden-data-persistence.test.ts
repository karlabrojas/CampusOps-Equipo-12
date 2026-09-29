import {
  maskIncidentForViewer,
  logIncidentEvent,
  saveLastViewedIncident,
  generateIncidentReport,
  safeLogIncidentEvent,
} from "./incidentPrivacy";
import type { Incident } from "../contracts";

const incident: Incident = {
  id: "campus-inc-010",
  reporterId: "reporter-77",
  category: "electrical",
  description: "Falla ficticia de contacto en laboratorio 3",
  location: { source: "manual", label: "Edificio ficticio, salon 3" },
  work: { assignedTechnicianId: "technician-5", status: "assigned" },
  version: 1,
};

describe("T-05 los datos ocultos no permanecen en logs, preferencias ni reportes", () => {
  it("nominal: el dueno ve su reporterId y ubicacion reales", () => {
    const masked = maskIncidentForViewer(incident, "reporter-77");
    expect(masked.reporterId).toBe("reporter-77");
    expect(masked.location).toBe("Edificio ficticio, salon 3");
  });

  it("failure: un tercero no ve el reporterId ni la ubicacion reales", () => {
    const masked = maskIncidentForViewer(incident, "reporter-99");
    expect(masked.reporterId).toBe("[HIDDEN]");
    expect(masked.location).toBe("[HIDDEN]");
  });

  it("no permanece en logs: el log de un tercero no contiene el dato real", () => {
    const log = logIncidentEvent(incident, "reporter-99");
    expect(log).not.toContain("reporter-77");
    expect(log).not.toContain("Edificio ficticio");
  });

  it("no permanece en preferencias: el storage guarda la version enmascarada", () => {
    const store = saveLastViewedIncident({}, incident, "reporter-99");
    expect(store.lastViewedIncident).not.toContain("reporter-77");
    expect(store.lastViewedIncident).not.toContain("Edificio ficticio");
  });

  it("no permanece en reportes: el reporte generado no expone el dato real", () => {
    const report = generateIncidentReport([incident], "reporter-99");
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("reporter-77");
    expect(serialized).not.toContain("Edificio ficticio");
  });

  it("camino de error: un incidente inexistente no expone datos ni truena la app", () => {
    const result = safeLogIncidentEvent(null, "reporter-99");
    expect(result).not.toContain("reporter-77");
    expect(() => safeLogIncidentEvent(null, "reporter-99")).not.toThrow();
  });

  it("no hay corrupcion de datos: el incidente original no se modifica al ocultar", () => {
    const before = JSON.stringify(incident);
    maskIncidentForViewer(incident, "reporter-99");
    expect(JSON.stringify(incident)).toBe(before);
  });

  it("boundary: el dueno real sigue viendo sus datos tras un intento fallido previo", () => {
    safeLogIncidentEvent(null, "reporter-77");
    const masked = maskIncidentForViewer(incident, "reporter-77");
    expect(masked.reporterId).toBe("reporter-77");
  });
});
