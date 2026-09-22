/** T-04: patrones de secretos (mismos que usa el evaluador del curso). */
export const SECRET_PATTERNS: Readonly<Record<string, RegExp>> = {
  private_key: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  github_token: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  aws_access_key: /\bAKIA[0-9A-Z]{16}\b/,
  public_secret_name: /EXPO_PUBLIC_[A-Z0-9_]*(?:SECRET|PRIVATE_KEY|ACCESS_TOKEN)\s*=/,
};

export function scanForSecrets(text: string): string[] {
  return Object.entries(SECRET_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}