import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectResumeKind, extractPdfText } from "@/lib/resume/pdf";

const fixture = readFileSync(
  join(__dirname, "../fixtures/sample-resume.pdf"),
);

describe("extractPdfText", () => {
  it("从最小 PDF fixture 中抽出文本", async () => {
    const text = await extractPdfText(fixture);
    expect(text).toContain("Kai Zhang - Backend Engineer");
    expect(text).toContain("payment gateway");
  });

  it("清理行尾空白并去除首尾空白", async () => {
    const text = await extractPdfText(fixture);
    for (const line of text.split("\n")) {
      expect(line).not.toMatch(/[ \t]$/);
    }
    expect(text).toBe(text.trim());
  });
});

describe("detectResumeKind（简历文件类型判定）", () => {
  it("扩展名优先：.pdf/.md/.markdown 各归其类，大小写不敏感", () => {
    expect(detectResumeKind("简历.PDF", "")).toBe("pdf");
    expect(detectResumeKind("resume.md", "")).toBe("markdown");
    expect(detectResumeKind("RESUME.MARKDOWN", "")).toBe("markdown");
  });

  it("MIME 作辅证：扩展名缺失时认 MIME", () => {
    expect(detectResumeKind("", "application/pdf")).toBe("pdf");
    expect(detectResumeKind("", "text/markdown")).toBe("markdown");
  });

  it("两者都不认识：null（调用方拒收）", () => {
    expect(detectResumeKind("photo.jpg", "image/jpeg")).toBeNull();
    expect(detectResumeKind("", "")).toBeNull();
  });
});
