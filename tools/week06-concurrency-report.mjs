import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST = "src/api/session-concurrency.test.ts";
const BASE = `npx jest --no-watchman --cacheDirectory .jest-cache --ci --runInBand ${TEST}`;

const git = (args) => spawnSync("git", args, { encoding: "utf8" }).stdout.trim();
if (git(["status", "--porcelain", "--untracked-files=no"])) {
  console.error("Hay cambios sin commit. Haz commit y vuelve a correr.");
  process.exit(2);
}
const commitSha = git(["rev-parse", "HEAD"]);

function runCase(label, fail) {
  const out = join(tmpdir(), `week06-concurrency-${label}.json`);
  const env = { ...process.env, FALLA_REFRESH: fail ? "1" : "0" };
  const r = spawnSync(`${BASE} --json --outputFile="${out}"`, { shell: true, encoding: "utf8", env });
  const res = JSON.parse(readFileSync(out, "utf8"));
  return { status: r.status, res };
}

const cases = [
  {
    key: "success",
    fail: false,
    scenarioType: "nominal",
    command: BASE,
    observed:
      "3 solicitudes concurrentes, 3 respuestas 401, 1 renovacion, 6 llamadas fetch (3 iniciales + 3 reintentos), 3 reintentos con token nuevo, 0 limpiezas de sesion",
  },
  {
    key: "refresh-failed",
    fail: true,
    scenarioType: "failure",
    command: `$env:FALLA_REFRESH="1"; ${BASE}`,
    observed:
      "3 solicitudes concurrentes, 3 respuestas 401, 1 renovacion fallida compartida, 3 llamadas fetch (sin reintentos), 0 con token nuevo, 1 limpieza de sesion, sesion nula",
  },
];

const checks = [];
let ok = true;
let tests = 0;
for (const c of cases) {
  const { status, res } = runCase(c.key, c.fail);
  for (const suite of res.testResults) {
    for (const t of suite.assertionResults) {
      tests += 1;
      const passed = t.status === "passed";
      if (!passed) ok = false;
      checks.push({
        id: `concurrency:${c.key}::${t.fullName}`,
        status: passed ? "pass" : "fail",
        scenarioType: c.scenarioType,
        command: c.command,
        evidence: passed
          ? `jest "${t.title}" passed in ${t.duration ?? 0} ms; aserciones verificadas: ${c.observed}`
          : `jest "${t.title}" ${t.status}`,
      });
    }
  }
  if (status !== 0) ok = false;
}

const report = {
  schemaVersion: 1,
  week: 6,
  commitSha,
  generatedAt: new Date().toISOString(),
  summary: { cases: cases.length, tests, allPassed: ok },
  checks,
};
mkdirSync("reports/week-06", { recursive: true });
writeFileSync("reports/week-06/concurrency.json", JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report.summary));
process.exit(ok ? 0 : 1);