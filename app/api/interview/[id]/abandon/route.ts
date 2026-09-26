import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { COPY } from "@/lib/copy";

export async function POST(
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
  const { data: interview, error: interviewError } = await supabase
    .from("interviews")
    .select("id, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (interviewError) {
    console.error("[interview/abandon] load interview failed:", interviewError.message);
    return NextResponse.json({ error: COPY.api.serverError }, { status: 500 });
  }
  if (!interview) {
    return NextResponse.json({ error: COPY.interview.notFound }, { status: 404 });
  }
  if (interview.status === "completed") {
    return NextResponse.json(
      { error: COPY.api.alreadyCompleted },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from("interviews")
    .update({ status: "abandoned" })
    .eq("id", id);
  if (error) {
    console.error("[interview/abandon] mark abandoned failed:", error.message);
    return NextResponse.json({ error: COPY.api.serverError }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
