import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const files = [
  "src/campusops/sync/syncCoordinator.test.ts",
  "src/course-evaluation/resolveSync.test.ts",
  "course-tests/public/week-08.test.ts",
  "src/campusops/infrastructure/localSyncStore.test.ts",
  "src/course-evaluation/index.test.ts",
];
const raw = join(tmpdir(), "week08-jest.json");
const command = `npx jest --no-watchman --cacheDirectory .jest-cache --ci --runInBand --json --outputFile="${raw}" ${files.join(" ")}`;
const run = spawnSync(command, { shell: true, stdio: "inherit" });

const data = JSON.parse(readFileSync(raw, "utf8"));
rmSync(raw, { force: true });
const sha = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();

const checks = [];
for (const suite of data.testResults) {
  for (const t of suite.assertionResults) {
    const m = /^\[(nominal|boundary|failure)\]/.exec(t.title);
    checks.push({
      id: `${basename(suite.name)}::${t.title}`,
      status: t.status === "passed" ? "pass" : "fail",
      scenarioType: m ? m[1] : "nominal",
      command,
      evidence: `Jest ${t.status} en ${t.duration ?? 0} ms: ${t.fullName}`,
    });
  }
}

mkdirSync("reports/week-08", { recursive: true });
writeFileSync(
  "reports/week-08/migration-tests.json",
  JSON.stringify({ schemaVersion: 1, week: 8, commitSha: sha, generatedAt: new Date().toISOString(), checks }, null, 2) + "\n",
);
console.log(`checks: ${checks.length}, fallidos: ${checks.filter((c) => c.status === "fail").length}`);
process.exit(run.status ?? 1);