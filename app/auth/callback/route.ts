import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // OAuth 拒绝授权时 Supabase 回跳携带 error 参数，转为登录页错误态
  if (searchParams.get("error")) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }
  if (code) {
    const supabase = await createSupabaseServerClient();
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      // 无效/过期 code（supabase-js 返回 error 而非抛出）：不 500，回登录页带错误键
      if (error) return NextResponse.redirect(`${origin}/login?error=auth`);
    } catch {
      return NextResponse.redirect(`${origin}/login?error=auth`);
    }
  }
  return NextResponse.redirect(`${origin}/dashboard`);
}
