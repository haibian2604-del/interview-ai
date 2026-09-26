import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { extractPdfText } from "@/lib/resume/pdf";
import { COPY } from "@/lib/copy";

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
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: COPY.api.pdfOnly }, { status: 400 });
  }
  // B7：文件大小上限 10MB，超限 422
  const MAX_PDF_BYTES = 10 * 1024 * 1024;
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: COPY.api.pdfTooLarge }, { status: 422 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  let rawText: string;
  try {
    rawText = await extractPdfText(buffer);
  } catch (e) {
    // 坏损 PDF：原始解析错误只进日志，客户端拿通用文案
    console.error(
      "[resume/parse] extractPdfText failed:",
      e instanceof Error ? e.message : String(e),
    );
    return NextResponse.json({ error: COPY.api.serverError }, { status: 500 });
  }
  if (rawText.length < 50) {
    return NextResponse.json({ error: COPY.api.pdfTextTooShort }, { status: 422 });
  }

  const supabase = await createSupabaseServerClient();
  const path = `${user.id}/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("resumes")
    .upload(path, buffer, { contentType: "application/pdf" });
  if (uploadError) {
    console.error("[resume/parse] storage upload failed:", uploadError.message);
    return NextResponse.json({ error: COPY.api.serverError }, { status: 500 });
  }
  const { data, error } = await supabase
    .from("resumes")
    .insert({ user_id: user.id, storage_path: path, raw_text: rawText })
    .select("id")
    .single();
  if (error) {
    console.error("[resume/parse] insert resume failed:", error.message);
    return NextResponse.json({ error: COPY.api.serverError }, { status: 500 });
  }
  return NextResponse.json({ resumeId: data.id, rawText });
}
