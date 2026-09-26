import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { COPY } from "@/lib/copy";

type RouteParams = { params: Promise<{ id: string }> };

/** DELETE /api/interview/[id]：销档。子表（questions/messages/evaluations/reports）经外键 on delete cascade 一并删除 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: COPY.api.unauthorized }, { status: 401 });
  }
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: interview } = await supabase
    .from("interviews")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!interview) {
    return NextResponse.json({ error: COPY.interview.notFound }, { status: 404 });
  }

  const { error } = await supabase.from("interviews").delete().eq("id", id).eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
