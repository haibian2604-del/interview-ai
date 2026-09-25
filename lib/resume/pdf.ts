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
