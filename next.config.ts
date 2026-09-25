import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse（pdf.js）通过动态 import 加载 pdf.worker.mjs，
  // 打包后 chunk 缺失导致 "Setting up fake worker failed"——外部化后运行时按 node_modules 原生解析
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
