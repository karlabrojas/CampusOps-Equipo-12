import type { Incident } from "../contracts";

const HIDDEN = "[HIDDEN]";

export type DisplayIncident = Readonly<{
  id: string;
  category: Incident["category"];
  description: string;
  location: string;
  reporterId: string;
  work: Incident["work"];
}>;

/**
 * Simula el "ocultar en la interfaz": un tercero no ve el reporterId real
 * ni la ubicacion exacta del incidente ajeno.
 */
export function maskIncidentForViewer(incident: Incident, viewerId: string): DisplayIncident {
  const isOwner = incident.reporterId === viewerId;
  return {
    id: incident.id,
    category: incident.category,
    description: incident.description,
    location: isOwner ? incident.location.label : HIDDEN,
    reporterId: isOwner ? incident.reporterId : HIDDEN,
    work: incident.work,
  };
}

export function logIncidentEvent(incident: Incident, viewerId: string): string {
  const masked = maskIncidentForViewer(incident, viewerId);
  return `incident=${masked.id} status=${masked.work.status} viewer=${viewerId}`;
}

type PreferenceStore = Record<string, string>;

export function saveLastViewedIncident(
  store: PreferenceStore,
  incident: Incident,
  viewerId: string,
): PreferenceStore {
  const masked = maskIncidentForViewer(incident, viewerId);
  return { ...store, lastViewedIncident: JSON.stringify(masked) };
}

export function generateIncidentReport(
  incidents: readonly Incident[],
  viewerId: string,
): ReadonlyArray<Record<string, unknown>> {
  return incidents.map((incident) => maskIncidentForViewer(incident, viewerId));
}

/** Camino de error: nunca debe exponer el incidente crudo ni tronar la app. */
export function safeLogIncidentEvent(incident: Incident | null | undefined, viewerId: string): string {
  try {
    if (!incident) {
      throw new Error("incident not found");
    }
    return logIncidentEvent(incident, viewerId);
  } catch {
    return `error handling incident event for viewer=${viewerId}`;
  }
}
