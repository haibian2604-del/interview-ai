import { NextResponse } from "next/server";
import { COPY } from "@/lib/copy";

/**
 * 500/502 的统一出口（打磨轮 B1 收敛）：
 * 客户端只见通用文案，原始错误以 scope 前缀进服务端日志。
 * scope 用「路由: 环节」命名（如 "interview/answer: load question/history"）。
 * 例外：create 路由的 schema 诊断面（模型输出头部）与 settings/test 的自查端点不经过这里。
 */
export function serverErrorResponse(
  scope: string,
  error: unknown,
  status: 500 | 502 = 500,
): NextResponse {
  console.error(`[${scope}]`, error instanceof Error ? error.message : String(error));
  return NextResponse.json({ error: COPY.api.serverError }, { status });
}
