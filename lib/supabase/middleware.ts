import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/dashboard", "/resumes", "/interview", "/report"];

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
  if (!isLoggedIn && PROTECTED.some((p) => path.startsWith(p))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (isLoggedIn && path === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return response;
}
