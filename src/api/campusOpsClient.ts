import type {
  Incident,
  IncidentCategory,
  IncidentRepository,
  IncidentStatus,
} from "../campusops/contracts";
import { parseRemoteResource } from "../course-evaluation";
import { BackendRequestError, requestCourseBackend } from "./courseBackend";

export type CampusOpsSession = Readonly<{
  actorId: string;
  accessToken: string;
}>;

export type CreateIncidentInput = Readonly<{
  category: IncidentCategory;
  description: string;
  location: string;
}>;

export type CreateIncidentResult = Readonly<{
  incident: Incident;
  operationId: string;
  duplicate: boolean;
}>;

export type CampusOpsApiErrorKind =
  "network" | "http" | "contract" | "domain" | "session" | "timeout";

export class CampusOpsApiError extends Error {
  constructor(
    readonly kind: CampusOpsApiErrorKind,
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly retryAfterMs?: number,
    readonly operationId?: string,
  ) {
    super(message);
    this.name = "CampusOpsApiError";
  }
}

export type CampusOpsClientOptions = Readonly<{
  getSession: () => CampusOpsSession | null;
  baseUrl?: string;
  fetcher?: typeof fetch;
  operationIdFactory?: () => string;
}>;

const INCIDENT_CATEGORIES = new Set<IncidentCategory>([
  "electrical",
  "laboratory",
  "water",
  "connectivity",
  "equipment",
  "safety",
  "maintenance",
]);

const INCIDENT_STATUSES = new Set<IncidentStatus>([
  "open",
  "assigned",
  "in_progress",
  "resolved",
  "closed",
]);

let operationSequence = 0;

function generateOperationId(): string {
  operationSequence += 1;
  return `incident-create-${Date.now()}-${operationSequence}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input);
}

function nonemptyString(input: unknown): input is string {
  return typeof input === "string" && input.trim().length > 0;
}

function apiErrorFromTransport(error: BackendRequestError): CampusOpsApiError {
  return new CampusOpsApiError(
    error.kind,
    error.message,
    error.status,
    error.code,
    error.retryAfterMs,
  );
}

function parseIncident(input: unknown): Incident {
  const parsed = parseRemoteResource(input);
  if (!parsed.ok) {
    throw new CampusOpsApiError(
      "contract",
      "Incident resource envelope is invalid",
    );
  }

  const { id, version, status, payload } = parsed.value;
  if (payload === null) {
    throw new CampusOpsApiError("domain", "Incident payload is unavailable");
  }

  const { category, description, location, reporterId, assignedTechnicianId } =
    payload;
  if (
    typeof category !== "string" ||
    !INCIDENT_CATEGORIES.has(category as IncidentCategory) ||
    !nonemptyString(description) ||
    !nonemptyString(location) ||
    !nonemptyString(reporterId) ||
    (assignedTechnicianId !== null && !nonemptyString(assignedTechnicianId)) ||
    !INCIDENT_STATUSES.has(status as IncidentStatus)
  ) {
    throw new CampusOpsApiError(
      "domain",
      "Incident payload does not match the application model",
    );
  }

  return {
    id,
    version,
    reporterId,
    category: category as IncidentCategory,
    description,
    location: { source: "manual", label: location },
    work: {
      assignedTechnicianId,
      status: status as IncidentStatus,
    },
  };
}

export class CampusOpsClient implements IncidentRepository {
  private readonly baseUrl: string | undefined;
  private readonly fetcher: typeof fetch | undefined;
  private readonly getSession: CampusOpsClientOptions["getSession"];
  private readonly operationIdFactory: () => string;

  constructor(options: CampusOpsClientOptions) {
    this.baseUrl = options.baseUrl;
    this.fetcher = options.fetcher;
    this.getSession = options.getSession;
    this.operationIdFactory = options.operationIdFactory ?? generateOperationId;
  }

  async findAll(): Promise<Incident[]> {
    const result = await this.request("/v1/incidents", "GET");
    if (!isRecord(result) || !Array.isArray(result.items)) {
      throw new CampusOpsApiError(
        "contract",
        "Incident list response is invalid",
      );
    }
    return result.items.map(parseIncident);
  }

  async findById(id: string): Promise<Incident | null> {
    if (!nonemptyString(id)) {
      throw new CampusOpsApiError("domain", "Incident id must not be empty");
    }
    try {
      return parseIncident(
        await this.request(`/v1/incidents/${encodeURIComponent(id)}`, "GET"),
      );
    } catch (error) {
      if (
        error instanceof CampusOpsApiError &&
        error.kind === "http" &&
        error.status === 404
      ) {
        return null;
      }
      throw error;
    }
  }

  async createIncident(
    input: CreateIncidentInput,
    operationId = this.operationIdFactory(),
  ): Promise<CreateIncidentResult> {
    if (
      !INCIDENT_CATEGORIES.has(input.category) ||
      !nonemptyString(input.description) ||
      !nonemptyString(input.location) ||
      operationId.trim().length < 8
    ) {
      throw new CampusOpsApiError(
        "domain",
        "Incident creation input is invalid",
      );
    }

    try {
      const result = await this.request(
        "/v1/incidents",
        "POST",
        {
          category: input.category,
          description: input.description,
          location: input.location,
        },
        operationId,
      );
      if (
        !isRecord(result) ||
        !nonemptyString(result.operationId) ||
        typeof result.duplicate !== "boolean"
      ) {
        throw new CampusOpsApiError(
          "contract",
          "Incident creation response is invalid",
        );
      }

      return {
        incident: parseIncident(result.incident),
        operationId: result.operationId,
        duplicate: result.duplicate,
      };
    } catch (error) {
      if (
        error instanceof CampusOpsApiError &&
        error.operationId === undefined
      ) {
        throw new CampusOpsApiError(
          error.kind,
          error.message,
          error.status,
          error.code,
          error.retryAfterMs,
          operationId,
        );
      }
      throw error;
    }
  }

  private async request(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
    operationId?: string,
  ): Promise<unknown> {
    const session = this.getSession();
    if (
      !session ||
      !nonemptyString(session.actorId) ||
      !nonemptyString(session.accessToken)
    ) {
      throw new CampusOpsApiError(
        "session",
        "An authenticated session is required",
      );
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      "X-Course-Actor": session.actorId,
    };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
      headers["Idempotency-Key"] = operationId ?? "";
    }

    try {
      return await requestCourseBackend(path, {
        ...(this.baseUrl === undefined ? {} : { baseUrl: this.baseUrl }),
        ...(this.fetcher === undefined ? {} : { fetcher: this.fetcher }),
        init: {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      });
    } catch (error) {
      if (error instanceof BackendRequestError) {
        throw apiErrorFromTransport(error);
      }
      throw error;
    }
  }
}
