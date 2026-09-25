import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { extractPdfText } from "@/lib/resume/pdf";

export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await requireUser();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "仅支持 PDF" }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const rawText = await extractPdfText(buffer);
  if (rawText.length < 50) {
    return NextResponse.json({ error: "PDF 文本过少，可能是扫描件" }, { status: 422 });
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
