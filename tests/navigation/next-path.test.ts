import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/navigation/next-path";

describe("safeNextPath", () => {
  it("放行站内绝对路径", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/interview/abc-123")).toBe("/interview/abc-123");
    expect(safeNextPath("/report/xyz?tab=1")).toBe("/report/xyz?tab=1");
  });

  it("拒绝空值与非路径", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath("dashboard")).toBeNull();
  });

  it("拒绝绝对 URL（开放重定向）", () => {
    expect(safeNextPath("https://evil.com")).toBeNull();
    expect(safeNextPath("http://evil.com/path")).toBeNull();
    expect(safeNextPath("javascript:alert(1)")).toBeNull();
  });

  it("拒绝协议相对地址 // 与 /\\\\", () => {
    expect(safeNextPath("//evil.com")).toBeNull();
    expect(safeNextPath("/\\evil.com")).toBeNull();
  });
});
