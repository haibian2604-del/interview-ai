import { PDFParse } from "pdf-parse";

// pdf-parse v2 的主入口无调试代码副作用，可直接 ESM 导入
// （v1 才需要 require("pdf-parse/lib/pdf-parse.js") 子路径规避调试执行）。
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const { text } = await parser.getText();
    return text.replace(/[ \t]+\n/g, "\n").trim();
  } finally {
    await parser.destroy();
  }
}

export type ResumeFileKind = "pdf" | "markdown";

/**
 * 简历文件类型判定（纯函数）：扩展名优先（浏览器对 .md 常给空 MIME），
 * MIME 作辅证；两者都不认识返回 null（调用方拒收）。
 */
export function detectResumeKind(fileName: string, mimeType: string): ResumeFileKind | null {
  const name = fileName.toLowerCase();
  if (name.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (name.endsWith(".md") || name.endsWith(".markdown") || mimeType === "text/markdown") {
    return "markdown";
  }
  return null;
}
