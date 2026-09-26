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
  const buffer = Buffer.from(await file.arrayBuffer());
  const rawText = await extractPdfText(buffer);
  if (rawText.length < 50) {
    return NextResponse.json({ error: COPY.api.pdfTextTooShort }, { status: 422 });
  }

  const supabase = await createSupabaseServerClient();
  const path = `${user.id}/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("resumes")
    .upload(path, buffer, { contentType: "application/pdf" });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }
  const { data, error } = await supabase
    .from("resumes")
    .insert({ user_id: user.id, storage_path: path, raw_text: rawText })
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ resumeId: data.id, rawText });
}
