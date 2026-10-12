import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const TESTS = [
  "src/campusops/security/t06-role-authorization.test.ts",
  "src/auth/session-auth-failures.test.ts",
];
const outFile = join(tmpdir(), "week06-auth-jest.json");
const command = `npx jest --no-watchman --cacheDirectory .jest-cache --ci --runInBand ${TESTS.join(" ")}`;

const git = (args) => spawnSync("git", args, { encoding: "utf8" }).stdout.trim();
if (git(["status", "--porcelain", "--untracked-files=no"])) {
  console.error("Hay cambios sin commit. Haz commit del codigo y vuelve a correr.");
  process.exit(2);
}
const commitSha = git(["rev-parse", "HEAD"]);

const run = spawnSync(`${command} --json --outputFile="${outFile}"`, {
  shell: true,
  encoding: "utf8",
});
const results = JSON.parse(readFileSync(outFile, "utf8"));

const checks = [];
for (const suite of results.testResults) {
  const file = relative(process.cwd(), suite.name).split("\\").join("/");
  for (const test of suite.assertionResults) {
    const match = /^(nominal|boundary|failure):/.exec(test.title);
    checks.push({
      id: `${file}::${test.fullName}`,
      status: test.status === "passed" ? "pass" : "fail",
      scenarioType: match ? match[1] : "nominal",
      command,
      evidence: `jest assertion "${test.title}" ${test.status} in ${test.duration ?? 0} ms (${file})`,
    });
  }
}

const report = {
  schemaVersion: 1,
  week: 6,
  commitSha,
  generatedAt: new Date().toISOString(),
  summary: {
    suites: results.numTotalTestSuites,
    tests: results.numTotalTests,
    passed: results.numPassedTests,
    failed: results.numFailedTests,
  },
  checks,
};

mkdirSync("reports/week-06", { recursive: true });
writeFileSync("reports/week-06/auth-tests.json", JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report.summary));
process.exit(run.status === 0 && results.numFailedTests === 0 ? 0 : 1);