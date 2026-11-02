import { writeFileSync } from "fs";
import { planRetry } from "../../course-evaluation";

type Reply = Readonly<{
  status: 200 | 429 | 503 | "timeout";
  retryAfterMs?: number;
}>;

type Observation = {
  id: string;
  scenarioType: "nominal" | "boundary" | "failure";
  method: "GET" | "POST";
  idempotencyKey: string | null;
  attempts: number;
  statuses: (number | "timeout")[];
  plannedDelaysMs: number[];
  virtualElapsedMs: number;
  retryAfterMs: number | null;
  retryAfterHonored: boolean | null;
  outcome: "succeeded" | "gave_up" | "not_retried";
  distinctKeysSent: number;
  distinctBodiesSent: number;
  serverEffects: number;
};

const observations: Observation[] = [];
const BODY = JSON.stringify({ incidentId: "campus-inc-001", status: "resolved" });

function makeServer() {
  const committed = new Set<string>();
  let effects = 0;
  return {
    commit(key: string) {
      if (!committed.has(key)) {
        committed.add(key);
        effects += 1;
      }
    },
    effects: () => effects,
  };
}

function observe(
  id: string,
  scenarioType: Observation["scenarioType"],
  method: "GET" | "POST",
  key: string | null,
  server: ReturnType<typeof makeServer>,
  send: (attempt: number) => Reply,
): Observation {
  const statuses: (number | "timeout")[] = [];
  const delays: number[] = [];
  const keys = new Set<string>();
  const bodies = new Set<string>();
  let elapsed = 0;
  let attempt = 1;
  let outcome: Observation["outcome"];
  let lastRetryAfter: number | null = null;

  for (;;) {
    keys.add(key ?? "none");
    bodies.add(BODY);
    const reply = send(attempt);
    statuses.push(reply.status);
    if (reply.status === 200) {
      outcome = "succeeded";
      break;
    }
    if (reply.retryAfterMs !== undefined) lastRetryAfter = reply.retryAfterMs;
    const plan = planRetry({
      method,
      status: reply.status,
      attempt,
      ...(reply.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: reply.retryAfterMs }),
      ...(key === null ? {} : { idempotencyKey: key }),
    });
    if (!plan.retry) {
      outcome = attempt === 1 ? "not_retried" : "gave_up";
      break;
    }
    delays.push(plan.delayMs);
    elapsed += plan.delayMs;
    attempt += 1;
    if (attempt > 10) throw new Error("runaway retry loop");
  }

  const result: Observation = {
    id,
    scenarioType,
    method,
    idempotencyKey: key,
    attempts: statuses.length,
    statuses,
    plannedDelaysMs: delays,
    virtualElapsedMs: elapsed,
    retryAfterMs: lastRetryAfter,
    retryAfterHonored:
      lastRetryAfter === null ? null : delays[0] === lastRetryAfter,
    outcome,
    distinctKeysSent: keys.size,
    distinctBodiesSent: bodies.size,
    serverEffects: server.effects(),
  };
  observations.push(result);
  return result;
}

afterAll(() => {
  const out = process.env.WEEK09_METRICS_OUT;
  if (out) {
    writeFileSync(
      out,
      JSON.stringify(
        {
          timeSource: "virtual-clock (planned delays; no real waiting)",
          executionKind: "controlled-double",
          observations,
        },
        null,
        2,
      ),
    );
  }
});

describe("Week 09 retry metrics (controlled double, virtual clock)", () => {
  it("lost response after commit: one retry, same key and body, one server effect", () => {
    const server = makeServer();
    const key = "resolve-campus-inc-001-op-m1";
    const o = observe("lost-response-after-commit", "failure", "POST", key, server, (attempt) => {
      server.commit(key);
      return attempt === 1 ? { status: "timeout" } : { status: 200 };
    });
    expect(o.attempts).toBe(2);
    expect(o.plannedDelaysMs).toEqual([500]);
    expect(o.distinctKeysSent).toBe(1);
    expect(o.distinctBodiesSent).toBe(1);
    expect(o.serverEffects).toBe(1);
    expect(o.outcome).toBe("succeeded");
  });

  it("429 with Retry-After: the wait equals the server value", () => {
    const server = makeServer();
    const key = "resolve-campus-inc-001-op-m2";
    const o = observe("retry-after-429", "boundary", "POST", key, server, (attempt) =>
      attempt === 1 ? { status: 429, retryAfterMs: 800 } : (server.commit(key), { status: 200 }),
    );
    expect(o.plannedDelaysMs).toEqual([800]);
    expect(o.retryAfterHonored).toBe(true);
    expect(o.serverEffects).toBe(1);
  });

  it("persistent timeout: stops at attempt 4 with finite delays", () => {
    const server = makeServer();
    const key = "resolve-campus-inc-001-op-m3";
    const o = observe("attempt-limit-4", "boundary", "POST", key, server, () => {
      server.commit(key);
      return { status: "timeout" };
    });
    expect(o.attempts).toBe(4);
    expect(o.plannedDelaysMs).toEqual([500, 1000, 2000]);
    expect(o.virtualElapsedMs).toBe(3500);
    expect(o.outcome).toBe("gave_up");
    expect(o.distinctKeysSent).toBe(1);
    expect(o.serverEffects).toBe(1);
  });

  it("POST without key and 503: not retried", () => {
    const server = makeServer();
    const o = observe("post-without-key-503", "failure", "POST", null, server, () => ({
      status: 503,
    }));
    expect(o.attempts).toBe(1);
    expect(o.plannedDelaysMs).toEqual([]);
    expect(o.outcome).toBe("not_retried");
    expect(o.serverEffects).toBe(0);
  });
});