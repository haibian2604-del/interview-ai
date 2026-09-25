import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { requireEnv } from "@/lib/env";

function key(): Buffer {
  return createHash("sha256").update(requireEnv("SETTINGS_SECRET")).digest();
}

/** AES-256-GCM 加密，密文格式 v1:<iv_b64>:<tag_b64>:<data_b64>（v1 前缀留升级余地） */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

export function decryptSecret(encoded: string): string {
  const [version, ivB64, tagB64, dataB64] = encoded.split(":");
  if (version !== "v1") throw new Error("unsupported secret version");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/** 掩码展示：短值全星，长值只露末 4 位 */
export function maskSecret(plaintext: string): string {
  return plaintext.length <= 4 ? "****" : `****${plaintext.slice(-4)}`;
}
