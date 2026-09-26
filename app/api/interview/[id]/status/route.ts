import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { COPY } from "@/lib/copy";
import { serverErrorResponse } from "@/lib/api/server-error";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: COPY.api.unauthorized }, { status: 401 });
  }
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: interview, error } = await supabase
    .from("interviews")
    .select("status, current_question_index, question_count")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    return serverErrorResponse("[interview/status] load interview failed:", error.message, 500);
  }
  if (!interview) {
    return NextResponse.json({ error: COPY.interview.notFound }, { status: 404 });
  }
  return NextResponse.json({
    status: interview.status,
    currentIndex: interview.current_question_index,
    questionCount: interview.question_count,
  });
}
