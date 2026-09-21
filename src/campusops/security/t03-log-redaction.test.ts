import { redactSecrets } from "./redact";

// T-03 - Filtrar datos en registros.
// Los valores se arman en tiempo de ejecucion para que este archivo no contenga
// secretos literales (el escaner del curso los detectaria). Todos son ficticios.
const fakeGithubToken = "ghp" + "_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4";
const fakeAwsKey = "AKIA" + "ABCDEFGHIJKLMNOP";
const fakePrivateKey = "-----BEGIN " + "PRIVATE KEY-----\nficticio\n-----END " + "PRIVATE KEY-----";

describe("T-03 filtrar datos en registros", () => {
  it("failure: elimina un token de GitHub ficticio", () => {
    const out = redactSecrets(`push con ${fakeGithubToken} fallido`);
    expect(out).not.toContain(fakeGithubToken);
    expect(out).toContain("[REDACTED]");
  });

  it("failure: elimina una clave de acceso ficticia", () => {
    expect(redactSecrets(`clave ${fakeAwsKey}`)).not.toContain(fakeAwsKey);
  });

  it("failure: elimina un bloque de clave privada ficticia", () => {
    expect(redactSecrets(`antes ${fakePrivateKey} despues`)).not.toContain("ficticio");
  });

  it("failure: elimina el valor de un encabezado Bearer", () => {
    const out = redactSecrets("Authorization: Bearer valor-ficticio-123");
    expect(out).not.toContain("valor-ficticio-123");
  });

  it("failure: elimina contrasenas y tokens dentro de un payload JSON", () => {
    const out = redactSecrets(JSON.stringify({ password: "clave-ficticia-1", note: "ok" }));
    expect(out).not.toContain("clave-ficticia-1");
    expect(out).toContain("note");
  });

  it("boundary: un mensaje sin secretos no se modifica", () => {
    const message = "Incidencia campus-inc-001 asignada a technician-1";
    expect(redactSecrets(message)).toBe(message);
  });
});