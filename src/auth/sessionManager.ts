import * as SecureStore from "expo-secure-store";
import { BackendRequestError, requestCourseBackend } from "../api/courseBackend";

export type CampusOpsRole = "reporter" | "technician" | "coordinator";

export type SessionSummary = Readonly<{
  actorId: string;
  role: CampusOpsRole;
  expiresAt: number;
}>;

export type SessionCredentials = Readonly<{
  actorId: string;
  accessToken: string;
}>;

type StoredSession = SessionSummary &
  Readonly<{
    accessToken: string;
    refreshToken: string;
  }>;

export type SessionState =
  | Readonly<{ status: "unauthenticated" }>
  | Readonly<{ status: "signingIn" }>
  | Readonly<{ status: "authenticated"; session: SessionSummary }>
  | Readonly<{ status: "expired" }>
  | Readonly<{ status: "refreshing" }>
  | Readonly<{ status: "loggingOut" }>;

export interface SessionStorage {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  clear(): Promise<void>;
}

export const secureSessionStorage: SessionStorage = {
  get: () => SecureStore.getItemAsync("campusops.session"),
  set: (value) => SecureStore.setItemAsync("campusops.session", value),
  clear: () => SecureStore.deleteItemAsync("campusops.session"),
};

export type SessionManagerOptions = Readonly<{
  storage?: SessionStorage;
  baseUrl?: string;
  fetcher?: typeof fetch;
  now?: () => number;
  scenario?: string;
}>;

type SessionResponse = Readonly<{
  actorId: string;
  role: CampusOpsRole;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}>;

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input);
}

function isNonemptyString(input: unknown): input is string {
  return typeof input === "string" && input.trim().length > 0;
}

function isRole(input: unknown): input is CampusOpsRole {
  return input === "reporter" || input === "technician" || input === "coordinator";
}

function parseSessionResponse(
  input: unknown,
  expectedActorId?: string,
): SessionResponse {
  if (
    !isRecord(input) ||
    !isNonemptyString(input.actorId) ||
    (expectedActorId !== undefined && input.actorId !== expectedActorId) ||
    !isRole(input.role) ||
    !isNonemptyString(input.accessToken) ||
    !isNonemptyString(input.refreshToken) ||
    typeof input.expiresIn !== "number" ||
    !Number.isFinite(input.expiresIn) ||
    input.expiresIn <= 0
  ) {
    throw new Error("Authentication response does not match the session contract");
  }

  return {
    actorId: input.actorId,
    role: input.role,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresIn: input.expiresIn,
  };
}

function parsePersistedSession(input: unknown): StoredSession | null {
  if (
    !isRecord(input) ||
    !isNonemptyString(input.actorId) ||
    !isRole(input.role) ||
    !isNonemptyString(input.accessToken) ||
    !isNonemptyString(input.refreshToken) ||
    typeof input.expiresAt !== "number" ||
    !Number.isFinite(input.expiresAt)
  ) {
    return null;
  }

  return {
    actorId: input.actorId,
    role: input.role,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAt: input.expiresAt,
  };
}

function parseRefreshResponse(input: unknown): Pick<
  SessionResponse,
  "accessToken" | "refreshToken" | "expiresIn"
> {
  if (
    !isRecord(input) ||
    !isNonemptyString(input.accessToken) ||
    !isNonemptyString(input.refreshToken) ||
    typeof input.expiresIn !== "number" ||
    !Number.isFinite(input.expiresIn) ||
    input.expiresIn <= 0
  ) {
    throw new Error("Refresh response does not match the session contract");
  }
  return {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresIn: input.expiresIn,
  };
}

export class SessionManager {
  private readonly storage: SessionStorage;
  private readonly baseUrl: string | undefined;
  private readonly fetcher: typeof fetch | undefined;
  private readonly now: () => number;
  private readonly scenario: string | undefined;
  private currentState: SessionState = { status: "unauthenticated" };
  private session: StoredSession | null = null;
  private revision = 0;
  private refreshPromise: Promise<SessionCredentials | null> | null = null;
  private storageQueue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(state: SessionState) => void>();

  constructor(options: SessionManagerOptions = {}) {
    this.storage = options.storage ?? secureSessionStorage;
    this.baseUrl = options.baseUrl;
    this.fetcher = options.fetcher;
    this.now = options.now ?? Date.now;
    this.scenario = options.scenario;
  }

  get state(): SessionState {
    this.detectExpiration();
    return this.currentState;
  }

  get currentSession(): SessionSummary | null {
    this.detectExpiration();
    return this.currentState.status === "authenticated" && this.session
      ? this.toSummary(this.session)
      : null;
  }

  subscribe(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async restore(): Promise<SessionState> {
    const revision = ++this.revision;
    this.session = null;
    this.setState({ status: "unauthenticated" });

    let serialized: string | null;
    try {
      serialized = await this.storage.get();
    } catch {
      throw new Error("Unable to read the persisted session");
    }
    if (revision !== this.revision) return this.currentState;
    if (serialized === null) return this.currentState;

    let restored: StoredSession | null = null;
    try {
      restored = parsePersistedSession(JSON.parse(serialized) as unknown);
    } catch {
      restored = null;
    }
    if (!restored) {
      await this.enqueueStorage(() => this.storage.clear());
      return this.currentState;
    }

    this.session = restored;
    if (restored.expiresAt <= this.now()) {
      this.setState({ status: "expired" });
      await this.refreshSession();
    } else {
      this.setState({
        status: "authenticated",
        session: this.toSummary(restored),
      });
    }
    return this.currentState;
  }

  async login(actorId: string): Promise<SessionSummary> {
    if (!isNonemptyString(actorId)) {
      throw new Error("A valid actor ID is required");
    }

    const revision = ++this.revision;
    this.session = null;
    this.setState({ status: "signingIn" });

    try {
      await this.enqueueStorage(() => this.storage.clear());
      const response = parseSessionResponse(
        await this.request("/v1/session/login", { actorId }),
      );
      if (revision !== this.revision) {
        throw new Error("Login was superseded by another session operation");
      }
      const session: StoredSession = {
        actorId: response.actorId,
        role: response.role,
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        expiresAt: this.now() + response.expiresIn * 1000,
      };
      await this.enqueueStorage(async () => {
        if (revision === this.revision) {
          await this.storage.set(JSON.stringify(session));
        }
      });
      if (revision !== this.revision) {
        throw new Error("Login was superseded by another session operation");
      }
      this.session = session;
      const summary = this.toSummary(session);
      this.setState({ status: "authenticated", session: summary });
      return summary;
    } catch (error) {
      if (revision === this.revision) {
        this.session = null;
        this.setState({ status: "unauthenticated" });
      }
      throw error;
    }
  }

  async getValidSession(): Promise<SessionCredentials | null> {
    this.detectExpiration();
    if (this.currentState.status === "authenticated" && this.session) {
      return this.toCredentials(this.session);
    }
    if (this.currentState.status === "expired" || this.currentState.status === "refreshing") {
      return this.refreshSession();
    }
    return null;
  }

  async refreshSession(): Promise<SessionCredentials | null> {
    if (this.refreshPromise) return this.refreshPromise;
    const previous = this.session;
    if (!previous || this.currentState.status === "loggingOut") return null;

    const revision = this.revision;
    this.setState({ status: "refreshing" });
    const refresh = this.performRefresh(previous, revision);
    this.refreshPromise = refresh;
    try {
      return await refresh;
    } finally {
      if (this.refreshPromise === refresh) this.refreshPromise = null;
    }
  }

  async logout(): Promise<void> {
    ++this.revision;
    this.session = null;
    this.refreshPromise = null;
    this.setState({ status: "loggingOut" });
    await this.enqueueStorage(() => this.storage.clear());
    this.setState({ status: "unauthenticated" });
  }

  private detectExpiration(): void {
    if (
      this.currentState.status === "authenticated" &&
      this.session !== null &&
      this.session.expiresAt <= this.now()
    ) {
      this.setState({ status: "expired" });
    }
  }

  private async performRefresh(
    previous: StoredSession,
    revision: number,
  ): Promise<SessionCredentials | null> {
    try {
      const response = parseRefreshResponse(
        await this.request("/v1/session/refresh", {
          refreshToken: previous.refreshToken,
        }),
      );
      if (revision !== this.revision || this.currentState.status === "loggingOut") {
        return null;
      }
      const session: StoredSession = {
        actorId: previous.actorId,
        role: previous.role,
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        expiresAt: this.now() + response.expiresIn * 1000,
      };
      await this.enqueueStorage(async () => {
        if (revision === this.revision) {
          await this.storage.set(JSON.stringify(session));
        }
      });
      if (revision !== this.revision) return null;
      this.session = session;
      this.setState({
        status: "authenticated",
        session: this.toSummary(session),
      });
      return this.toCredentials(session);
    } catch (error) {
      if (revision !== this.revision) return null;
      this.session = null;
      this.setState({ status: "unauthenticated" });
      await this.enqueueStorage(() => this.storage.clear());
      if (error instanceof BackendRequestError) return null;
      throw error;
    }
  }

  private async request(path: string, body: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (this.scenario !== undefined) {
      headers["X-Course-Scenario"] = this.scenario;
    }
    return requestCourseBackend(path, {
      ...(this.baseUrl === undefined ? {} : { baseUrl: this.baseUrl }),
      ...(this.fetcher === undefined ? {} : { fetcher: this.fetcher }),
      init: {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
    });
  }

  private enqueueStorage<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.storageQueue.then(operation);
    this.storageQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private setState(state: SessionState): void {
    this.currentState = state;
    for (const listener of this.listeners) listener(state);
  }

  private toSummary(session: StoredSession): SessionSummary {
    return {
      actorId: session.actorId,
      role: session.role,
      expiresAt: session.expiresAt,
    };
  }

  private toCredentials(session: StoredSession): SessionCredentials {
    return {
      actorId: session.actorId,
      accessToken: session.accessToken,
    };
  }
}
