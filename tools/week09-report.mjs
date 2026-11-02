import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const SUITES = [
  "src/campusops/integration",
  "src/campusops/infrastructure/locationService.test.ts",
  "src/campusops/infrastructure/geocodingProvider.test.ts",
  "src/course-evaluation/locationSelection.test.ts",
  "course-tests/public/week-09.test.ts",
];
const JEST_OUT = ".jest-cache/week09-jest.json";
const METRICS_RAW = ".jest-cache/week09-metrics-raw.json";

const git = (...args) =>
  spawnSync("git", args, { encoding: "utf8" }).stdout.trim();

const sha = git("rev-parse", "HEAD");
const dirty = git("status", "--porcelain", "--", "src", "docs", "course-tests", "tools", "package.json");
if (dirty && !process.argv.includes("--allow-dirty")) {
  console.error("Hay cambios sin commitear en el codigo; commitea antes de generar reportes:\n" + dirty);
  process.exit(2);
}

mkdirSync(".jest-cache", { recursive: true });
const command =
  "npx jest --no-watchman --cacheDirectory .jest-cache --ci --runInBand --json " +
  `--outputFile=${JEST_OUT} ${SUITES.join(" ")}`;
const run = spawnSync(command, {
  shell: true,
  stdio: "inherit",
  env: { ...process.env, WEEK09_METRICS_OUT: METRICS_RAW },
});

const results = JSON.parse(readFileSync(JEST_OUT, "utf8"));
const raw = JSON.parse(readFileSync(METRICS_RAW, "utf8"));

const FAILURE_RE = /timeout|network|rate_limited|http 503|lost response|expired|never caches|programming errors|without a key|without key/i;
const BOUNDARY_RE = /attempt 4|retry-after|limit|boundary|same operationId twice/i;
function classify(name) {
  if (FAILURE_RE.test(name)) return "failure";
  if (BOUNDARY_RE.test(name)) return "boundary";
  return "nominal";
}

const checks = [];
for (const file of results.testResults) {
  const base = file.name.split(/[\\/]/).pop();
  const kind = file.name.includes("integration") ? "controlled-double" : "unit-or-public-contract";
  for (const t of file.assertionResults) {
    if (t.status === "pending" || t.status === "todo") continue;
    const failed = t.status !== "passed";
    const message = failed ? " | " + String((t.failureMessages ?? [""])[0]).replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0].slice(0, 200) : "";
    checks.push({
      id: `${base}::${t.title}`,
      status: failed ? "fail" : "pass",
      scenarioType: classify(t.fullName),
      command,
      evidence: `Jest ${t.status} en ${t.duration ?? 0} ms: ${t.fullName}${message}`,
      executionKind: kind,
    });
  }
}

const environment = {
  os: process.platform,
  node: process.version,
  note: "Dobles controlados locales; ninguna consulta a un proveedor externo real.",
};
const envelope = (extra) => ({
  schemaVersion: 1,
  week: 9,
  commitSha: sha,
  generatedAt: new Date().toISOString(),
  environment,
  ...extra,
});

const metricsFailed = checks.filter((c) => c.id.startsWith("week09.metrics.test.ts")).some((c) => c.status === "fail");
const metricChecks = raw.observations.map((o) => ({
  id: `metrics::${o.id}`,
  status: metricsFailed ? "fail" : "pass",
  scenarioType: o.scenarioType,
  command,
  evidence:
    `attempts=${o.attempts}; statuses=${JSON.stringify(o.statuses)}; plannedDelaysMs=${JSON.stringify(o.plannedDelaysMs)}; ` +
    `retryAfterHonored=${o.retryAfterHonored}; distinctKeysSent=${o.distinctKeysSent}; distinctBodiesSent=${o.distinctBodiesSent}; ` +
    `serverEffects=${o.serverEffects}; outcome=${o.outcome}`,
}));

mkdirSync("reports/week-09", { recursive: true });
writeFileSync("reports/week-09/fault-injection.json", JSON.stringify(envelope({ checks }), null, 2) + "\n");
writeFileSync(
  "reports/week-09/retry-metrics.json",
  JSON.stringify(
    envelope({ timeSource: raw.timeSource, checks: metricChecks, operations: raw.observations }),
    null,
    2,
  ) + "\n",
);
rmSync(JEST_OUT, { force: true });
rmSync(METRICS_RAW, { force: true });

const failed = checks.filter((c) => c.status === "fail");
console.log(`\ncommitSha=${sha}\nchecks=${checks.length} fallidos=${failed.length}`);
for (const c of failed) console.log(`  FAIL ${c.id}`);
process.exit(run.status === 0 ? 0 : 1);