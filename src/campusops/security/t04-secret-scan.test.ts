import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { scanForSecrets } from "./secretScan";

// T-04 - Exponer credenciales.
// Los valores ficticios se arman en tiempo de ejecucion: este archivo no contiene
// secretos literales.
const EXCLUDED_DIRS = new Set([
  ".git",
  ".expo",
  "node_modules",
  "coverage",
  "dist",
  "android",
  "ios",
  ".jest-cache",
]);
const BINARY = /\.(png|jpg|jpeg|gif|zip|apk|aab)$/i;

function collectSecretHits(root: string, dir: string = root): string[] {
  const hits: string[] = [];
  for (const name of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(name) || name === ".env.example" || BINARY.test(name))
      continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      hits.push(...collectSecretHits(root, path));
      continue;
    }
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const pattern of scanForSecrets(text)) {
      hits.push(`${relative(root, path)}:${pattern}`);
    }
  }
  return hits;
}

describe("T-04 exponer credenciales", () => {
  it("failure: el escaner detecta una variable publica con nombre de secreto", () => {
    expect(
      scanForSecrets("EXPO_PUBLIC_" + "DEMO_SECRET=valor-ficticio"),
    ).toContain("public_secret_name");
  });

  it("failure: el escaner detecta un token de GitHub ficticio", () => {
    expect(
      scanForSecrets("ghp" + "_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4"),
    ).toContain("github_token");
  });

  it("failure: el escaner detecta una clave privada ficticia", () => {
    expect(scanForSecrets("-----BEGIN " + "PRIVATE KEY-----")).toContain(
      "private_key",
    );
  });

  it("boundary: un texto sin secretos no produce coincidencias", () => {
    expect(
      scanForSecrets("EXPO_PUBLIC_COURSE_BACKEND_URL=http://127.0.0.1:4310"),
    ).toEqual([]);
  });

  it("nominal: el repositorio no contiene secretos", () => {
    expect(collectSecretHits(process.cwd())).toEqual([]);
  });
  it("failure: el escaner detecta un Bearer token ficticio", () => {
    const fakeBearer = "Bearer " + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4";
    expect(scanForSecrets(`Authorization: ${fakeBearer}`)).toContain(
      "bearer_token",
    );
  });
  it("failure: el escaner detecta un valor sensible dentro de JSON", () => {
    expect(
      scanForSecrets(
        JSON.stringify({ password: "clave-ficticia-1", note: "ok" }),
      ),
    ).toContain("json_secret_value");
  });
});
