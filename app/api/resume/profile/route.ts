import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { loadInterviewProfile } from "@/lib/interview/profile";
import { COPY } from "@/lib/copy";
import { serverErrorResponse } from "@/lib/api/server-error";

// 画像 LLM 分析可能较慢，给足时长（先例同 next-question）
export const maxDuration = 300;

/**
 * 简历画像生成（幂等）：已有 structured_json 直接返回，不再调 LLM；
 * 没有则现场分析并回写（loadInterviewProfile）。档案页两处调用——
 * 上传/粘贴成功后的后台预热、展开简历时的兜底生成（含存量旧档案）。
 */
export async function POST(request: Request) {
  // /api/* 不在 middleware 的 PROTECTED 名单内，这里自己兜住未登录（与 /api/resume/parse 同一先例）
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: COPY.api.unauthorized }, { status: 401 });
  }
  let body: { resumeId?: string };
  try {
    body = (await request.json()) as { resumeId?: string };
  } catch {
    return NextResponse.json({ error: COPY.api.invalidJson }, { status: 400 });
  }
  const resumeId = typeof body.resumeId === "string" ? body.resumeId : "";
  if (!resumeId) {
    return NextResponse.json({ error: COPY.api.missingResumeId }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  // 存在性与幂等短路在这里收口：404（他人卷/已销档）与已生成都不再往下走
  const { data: existing, error: fetchError } = await supabase
    .from("resumes")
    .select("structured_json")
    .eq("id", resumeId)
    .eq("user_id", user.id)
    .single();
  if (fetchError || !existing) {
    return NextResponse.json({ error: COPY.api.resumeNotFound }, { status: 404 });
  }
  if (existing.structured_json) {
    return NextResponse.json({ profile: existing.structured_json });
  }
  try {
    const profile = await loadInterviewProfile(supabase, user.id, resumeId);
    return NextResponse.json({ profile });
  } catch (e) {
    return serverErrorResponse("[resume/profile] analyze failed:", e, 502);
  }
}
