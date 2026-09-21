const REDACTED = "[REDACTED]";

const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g;
const GITHUB_TOKEN = /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g;
const AWS_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;
const BEARER_HEADER = /\bBearer\s+\S+/g;
const JSON_SECRET_FIELD =
  /("(?:password|token|secret|apiKey|api_key|access_token)"\s*:\s*")[^"]*(")/gi;

export function redactSecrets(text: string): string {
  return text
    .replace(PRIVATE_KEY_BLOCK, REDACTED)
    .replace(GITHUB_TOKEN, REDACTED)
    .replace(AWS_ACCESS_KEY, REDACTED)
    .replace(BEARER_HEADER, `Bearer ${REDACTED}`)
    .replace(JSON_SECRET_FIELD, `$1${REDACTED}$2`);
}
