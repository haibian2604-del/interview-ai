export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env: ${key}`);
  return value;
}

export function optionalEnv(key: string): string | undefined {
  const value = process.env[key];
  return value === "" ? undefined : value;
}
