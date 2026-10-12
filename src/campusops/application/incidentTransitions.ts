import type { Incident, IncidentStatus, IncidentWork } from "../contracts";
import type { IncidentStore } from "./assignIncident";
import { assertCanOperateOn, assertRoleCanPerform } from "./authorization";
import type { IncidentOperation } from "./authorization";

export type TransitionCommand = Readonly<{
  actorId: string;
  incidentId: string;
  baseVersion: number;
}>;

type Rule = Readonly<{
  from: readonly IncidentStatus[];
  next: (work: IncidentWork) => IncidentWork;
}>;

const RULES: Readonly<Record<"resolve" | "close" | "reopen", Rule>> = {
  // El tecnico resuelve una incidencia asignada (aun sin "start" explicito) o en proceso.
  resolve: {
    from: ["assigned", "in_progress"],
    next: (work) => ({ ...work, status: "resolved" }),
  },
  // Solo coordinacion cierra, y solo una incidencia ya resuelta.
  close: {
    from: ["resolved"],
    next: (work) => ({ ...work, status: "closed" }),
  },
  // Reabrir devuelve a "assigned" y exige tecnico asignado.
  reopen: {
    from: ["resolved", "closed"],
    next: (work) => {
      if (work.assignedTechnicianId === null) {
        throw new Error("invalid-state: cannot reopen without an assigned technician");
      }
      return { ...work, status: "assigned" };
    },
  },
};

async function transition(
  store: IncidentStore,
  operation: IncidentOperation & keyof typeof RULES,
  command: TransitionCommand,
): Promise<Incident> {
  // 1) Rol: se rechaza antes de tocar el repositorio.
  assertRoleCanPerform(command.actorId, operation);

  const incident = await store.findById(command.incidentId);
  if (!incident) {
    throw new Error("not-found: incident does not exist");
  }

  // 2) Asignacion (tecnico) sobre la incidencia real.
  assertCanOperateOn(command.actorId, operation, incident);

  if (incident.version !== command.baseVersion) {
    throw new Error("conflict: incident version changed");
  }

  const rule = RULES[operation];
  if (!rule.from.includes(incident.work.status)) {
    throw new Error(`invalid-state: cannot ${operation} from ${incident.work.status}`);
  }

  const updated: Incident = {
    ...incident,
    work: rule.next(incident.work),
    version: incident.version + 1,
  };
  await store.save(updated);
  return updated;
}

export class ResolveIncident {
  constructor(private readonly store: IncidentStore) {}
  execute(command: TransitionCommand): Promise<Incident> {
    return transition(this.store, "resolve", command);
  }
}

export class CloseIncident {
  constructor(private readonly store: IncidentStore) {}
  execute(command: TransitionCommand): Promise<Incident> {
    return transition(this.store, "close", command);
  }
}

export class ReopenIncident {
  constructor(private readonly store: IncidentStore) {}
  execute(command: TransitionCommand): Promise<Incident> {
    return transition(this.store, "reopen", command);
  }
}