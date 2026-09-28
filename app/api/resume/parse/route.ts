import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { detectResumeKind, extractPdfText } from "@/lib/resume/pdf";
import { COPY } from "@/lib/copy";
import { serverErrorResponse } from "@/lib/api/server-error";

export const maxDuration = 60;

export async function POST(request: Request) {
  // /api/* 不在 middleware 的 PROTECTED 名单内，这里自己兜住未登录
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: COPY.api.unauthorized }, { status: 401 });
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: COPY.api.missingFileField }, { status: 400 });
  }
  // 用户自命名（可选）：空/缺省 = null，展示层回落档案编号
  const nameRaw = form.get("name");
  const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim().slice(0, 100) : null;
  const kind = detectResumeKind(file.name ?? "", file.type ?? "");
  if (!kind) {
    return NextResponse.json({ error: COPY.api.pdfOnly }, { status: 400 });
  }
  // B7：文件大小上限 10MB，超限 422
  const MAX_RESUME_BYTES = 10 * 1024 * 1024;
  if (file.size > MAX_RESUME_BYTES) {
    return NextResponse.json({ error: COPY.api.pdfTooLarge }, { status: 422 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());

  let rawText: string;
  let storageExt: string;
  let storageType: string;
  if (kind === "pdf") {
    try {
      rawText = await extractPdfText(buffer);
    } catch (e) {
      // 坏损 PDF：原始解析错误只进日志，客户端拿通用文案
      return serverErrorResponse("[resume/parse]", e, 500);
    }
    storageExt = "pdf";
    storageType = "application/pdf";
  } else {
    // Markdown：直接按 UTF-8 读取；\0 是二进制特征，UTF-8 解不出来的东西不当简历收
    rawText = buffer.toString("utf8").replace(/\u0000/g, "");
    if (buffer.includes(0)) {
      return NextResponse.json({ error: COPY.api.pdfOnly }, { status: 400 });
    }
    rawText = rawText.trim();
    storageExt = "md";
    storageType = "text/markdown; charset=utf-8";
  }
  if (rawText.length < 50) {
    return NextResponse.json({ error: COPY.api.pdfTextTooShort }, { status: 422 });
  }

  const supabase = await createSupabaseServerClient();
  const path = `${user.id}/${crypto.randomUUID()}.${storageExt}`;
  const { error: uploadError } = await supabase.storage
    .from("resumes")
    .upload(path, buffer, { contentType: storageType });
  if (uploadError) {
    return serverErrorResponse("[resume/parse] storage upload failed:", uploadError.message, 500);
  }
  const { data, error } = await supabase
    .from("resumes")
    .insert({ user_id: user.id, storage_path: path, raw_text: rawText, name })
    .select("id")
    .single();
  if (error) {
    return serverErrorResponse("[resume/parse] insert resume failed:", error.message, 500);
  }
  return NextResponse.json({ resumeId: data.id, rawText });
}
