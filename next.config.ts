import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse（pdf.js）通过动态 import 加载 pdf.worker.mjs，
  // 打包后 chunk 缺失导致 "Setting up fake worker failed"——外部化后运行时按 node_modules 原生解析
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  // 技能 markdown（skills/project-grill/）运行时经 fs 读取、不在 import 依赖图内，
  // 显式纳入文件追踪防打包遗漏（消费方：interview create/answer/start/next-question）
  outputFileTracingIncludes: {
    "/api/**": ["./skills/project-grill/**/*"],
  },
};

export default nextConfig;
