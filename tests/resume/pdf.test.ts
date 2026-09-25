import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractPdfText } from "@/lib/resume/pdf";

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
