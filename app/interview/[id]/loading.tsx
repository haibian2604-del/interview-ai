import { COPY } from "@/lib/copy";

// 面试路由的「翻卷」过场：出卷盖章后进场、目录续卷、刷新恢复共用——
// RSC 载入期间给出评分簿世界的一致帧，遮住服务端取数间隙（无 loading 时路由切换是死等）
export default function Loading() {
  return (
    <main className="flex min-h-screen flex-col bg-paper text-ink">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-10">
        <p className="font-mono text-xs tracking-[0.35em] text-pencil uppercase">
          {COPY.interview.loadingVolume}
        </p>
        <span
          aria-hidden
          className="mirror-print-cycle mt-5 block h-px w-56 bg-ink/50"
        />
      </div>
    </main>
  );
}
