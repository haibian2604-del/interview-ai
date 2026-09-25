"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { COPY } from "@/lib/copy";

// 退出登录：清会话后回登录页（Dashboard 卷首唯一需要客户端的部分）
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await createSupabaseBrowserClient().auth.signOut();
      router.push("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="rounded-none text-pencil hover:text-ink"
      disabled={busy}
      onClick={() => void signOut()}
    >
      {busy ? COPY.dashboard.signingOut : COPY.dashboard.navSignOut}
    </Button>
  );
}
