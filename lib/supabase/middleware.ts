import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/dashboard", "/resumes", "/settings", "/interview", "/report"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isLoggedIn = !!data.user;
  // B8：按段匹配——/report-xxx 这类同前缀的公开路径不再被误保护
  const isProtected = PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));
  if (!isLoggedIn && isProtected) {
    // B9：登录后回跳来源页——带 ?next= 原路径，由 /auth/callback 与登录页消费
    const login = new URL("/login", request.url);
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }
  if (isLoggedIn && path === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return response;
}
