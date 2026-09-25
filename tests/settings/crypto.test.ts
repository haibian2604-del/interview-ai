import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

describe("settings/crypto", () => {
  const ORIG = { ...process.env };
  beforeEach(() => {
    vi.stubEnv("SETTINGS_SECRET", "test-settings-secret-high-entropy");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...ORIG };
  });

  it("roundtrip：解密还原明文", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/settings/crypto");
    const plaintext = "sk-abc123XYZ-中文-key";
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
  });

  it("密文为 v1:iv:tag:data 四段格式", async () => {
    const { encryptSecret } = await import("@/lib/settings/crypto");
    const enc = encryptSecret("sk-test");
    const parts = enc.split(":");
    expect(parts[0]).toBe("v1");
    expect(parts).toHaveLength(4);
    // iv 固定 12 字节 → base64 定长
    expect(Buffer.from(parts[1], "base64")).toHaveLength(12);
    // GCM tag 固定 16 字节
    expect(Buffer.from(parts[2], "base64")).toHaveLength(16);
  });

  it("相同明文两次加密密文不同（随机 iv）", async () => {
    const { encryptSecret } = await import("@/lib/settings/crypto");
    expect(encryptSecret("sk-same")).not.toBe(encryptSecret("sk-same"));
  });

  it("篡改密文任一字符：解密抛错", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/settings/crypto");
    const enc = encryptSecret("sk-tamper-me");
    // 逐段尝试篡改（iv/tag/data），GCM 校验都应失败
    const parts = enc.split(":");
    for (const i of [1, 2, 3]) {
      const flipped = parts[i].startsWith("A") ? `B${parts[i].slice(1)}` : `A${parts[i].slice(1)}`;
      const tampered = [...parts.slice(0, i), flipped, ...parts.slice(i + 1)].join(":");
      expect(() => decryptSecret(tampered)).toThrow();
    }
  });

  it("错误的 SETTINGS_SECRET：解密抛错", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/settings/crypto");
    const enc = encryptSecret("sk-wrong-secret");
    vi.stubEnv("SETTINGS_SECRET", "another-secret-entirely");
    expect(() => decryptSecret(enc)).toThrow();
  });

  it("非 v1 前缀：解密抛错（格式前缀校验）", async () => {
    const { decryptSecret } = await import("@/lib/settings/crypto");
    expect(() => decryptSecret("v2:aaaa:bbbb:cccc")).toThrow(/unsupported secret version/);
    expect(() => decryptSecret("plaintext-key")).toThrow(/unsupported secret version/);
  });

  it("缺 SETTINGS_SECRET 时加密抛出带 key 名的错误", async () => {
    vi.stubEnv("SETTINGS_SECRET", "");
    const { encryptSecret } = await import("@/lib/settings/crypto");
    expect(() => encryptSecret("sk-x")).toThrow(/SETTINGS_SECRET/);
  });

  describe("maskSecret", () => {
    it("短值（≤4）全星号", async () => {
      const { maskSecret } = await import("@/lib/settings/crypto");
      expect(maskSecret("")).toBe("****");
      expect(maskSecret("a")).toBe("****");
      expect(maskSecret("abcd")).toBe("****");
    });

    it("长值只露末 4 位", async () => {
      const { maskSecret } = await import("@/lib/settings/crypto");
      expect(maskSecret("sk-1234567890")).toBe("****7890");
    });
  });
});
