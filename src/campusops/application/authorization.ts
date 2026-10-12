import type { CampusRole, Incident } from "../contracts";

export type IncidentOperation = "assign" | "resolve" | "close" | "reopen";

export function resolveRole(actorId: string): CampusRole | null {
  if (/^reporter-/.test(actorId)) return "reporter";
  if (/^technician-/.test(actorId)) return "technician";
  if (/^coordinator-/.test(actorId)) return "coordinator";
  return null;
}

const ROLE_PERMISSIONS: Readonly<Record<CampusRole, readonly IncidentOperation[]>> = {
  reporter: [],
  technician: ["resolve"],
  coordinator: ["assign", "close", "reopen"],
};

/** Verifica que el rol del actor permita la operacion. Lanza "forbidden:" si no. */
export function assertRoleCanPerform(actorId: string, operation: IncidentOperation): CampusRole {
  const role = resolveRole(actorId);
  if (!role || !ROLE_PERMISSIONS[role].includes(operation)) {
    throw new Error(`forbidden: actor cannot ${operation} incidents`);
  }
  return role;
}

/** Ademas del rol, un tecnico solo opera incidencias que tiene asignadas. */
export function assertCanOperateOn(
  actorId: string,
  operation: IncidentOperation,
  incident: Incident,
): void {
  const role = assertRoleCanPerform(actorId, operation);
  if (role === "technician" && incident.work.assignedTechnicianId !== actorId) {
    throw new Error("forbidden: incident is not assigned to actor");
  }
}