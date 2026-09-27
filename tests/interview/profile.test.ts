import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/agents/resume-analyst", () => ({ analyzeResume: vi.fn() }));

import { analyzeResume } from "@/lib/agents/resume-analyst";
import type { ResumeProfile } from "@/lib/ai/schemas";
import { loadInterviewProfile } from "@/lib/interview/profile";

const PROFILE: ResumeProfile = {
  summary: "五年后端工程师",
  skills: ["Go", "Postgres"],
  experiences: [{ company: "某厂", title: "后端工程师", highlights: ["支撑百万 QPS"] }],
  projects: [{ name: "网关", highlights: ["熔断降级"] }],
};

type FakeOpts = {
  resumeRow?: Record<string, unknown> | null;
  resumeError?: { message: string } | null;
  updateError?: { message: string } | null;
};

/** 只实现 loadInterviewProfile 用到的最小查询链（select→eq→eq→single / update→eq） */
function makeFakeDb(opts: FakeOpts) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    from: (table: string) => {
      if (table !== "resumes") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({ data: opts.resumeRow ?? null, error: opts.resumeError ?? null }),
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          updates.push(patch);
          return { eq: async () => ({ error: opts.updateError ?? null }) };
        },
      };
    },
  } as unknown as Parameters<typeof loadInterviewProfile>[0];
  return { db, updates };
}

describe("loadInterviewProfile（real 模式画像加载）", () => {
  beforeEach(() => {
    vi.mocked(analyzeResume).mockReset();
    vi.mocked(analyzeResume).mockResolvedValue(PROFILE);
  });

  it("structured_json 已存在：直接返回，不跑分析也不回写", async () => {
    const { db, updates } = makeFakeDb({ resumeRow: { raw_text: "原文", structured_json: PROFILE } });
    const profile = await loadInterviewProfile(db, "u1", "r1");
    expect(profile).toEqual(PROFILE);
    expect(analyzeResume).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("无 structured_json：现场分析并回写，返回画像", async () => {
    const { db, updates } = makeFakeDb({ resumeRow: { raw_text: "原文", structured_json: null } });
    const profile = await loadInterviewProfile(db, "u1", "r1");
    expect(profile).toEqual(PROFILE);
    expect(analyzeResume).toHaveBeenCalledWith("u1", "原文");
    expect(updates).toEqual([{ structured_json: PROFILE }]);
  });

  it("回写失败仅记日志，仍返回画像（不抛错、不回滚）", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, updates } = makeFakeDb({
      resumeRow: { raw_text: "原文", structured_json: null },
      updateError: { message: "RLS denied" },
    });
    const profile = await loadInterviewProfile(db, "u1", "r1");
    expect(profile).toEqual(PROFILE);
    expect(errSpy).toHaveBeenCalledWith(
      "[interview/profile] writeback structured_json failed:",
      "RLS denied",
    );
    errSpy.mockRestore();
  });

  it("resume 读取失败：抛错", async () => {
    const { db, updates } = makeFakeDb({ resumeError: { message: "row not found" } });
    await expect(loadInterviewProfile(db, "u1", "r1")).rejects.toThrow("row not found");
  });
});
