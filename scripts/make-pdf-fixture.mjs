// 生成最小未压缩 PDF fixture（tests/fixtures/sample-resume.pdf）。
// 手写 PDF 文本对象：无字体嵌入、无流压缩，pdf.js 可直接解析提取文本。
// 用法：node scripts/make-pdf-fixture.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// 两行简历样文（含尾部空格行，用于验证 extractPdfText 的行尾空白清理）
const lines = [
  "(Kai Zhang - Backend Engineer) Tj",
  "(Go / Kubernetes / PostgreSQL, five years experience.) Tj",
  "(Built a high-concurrency payment gateway. ) Tj",
];

const content = [
  "BT",
  "/F1 18 Tf",
  "16 TL",
  "72 720 Td",
  ...lines.flatMap((l, i) => (i === 0 ? [l] : ["T*", l])),
  "ET",
].join("\n");

const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];

let pdf = "%PDF-1.4\n";
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xrefStart = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const off of offsets) {
  pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

const out = join(root, "tests/fixtures/sample-resume.pdf");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, pdf, "binary");
console.log("written", out, Buffer.byteLength(pdf), "bytes");
