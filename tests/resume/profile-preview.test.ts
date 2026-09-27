import { describe, expect, it } from "vitest";
import { resumeProfilePreview, resumeRawExcerpt } from "@/lib/resume/profile-preview";

describe("resumeProfilePreview", () => {
  it("从合法 structured_json 提取摘要与 skills 前 6 个", () => {
    const profile = {
      summary: "八年后端，支付方向",
      skills: ["Go", "K8s", "MySQL", "Redis", "Kafka", "gRPC", "Docker", "ETCD"],
      experiences: [],
      projects: [],
    };
    const view = resumeProfilePreview(profile);
    expect(view).not.toBeNull();
    expect(view?.summary).toBe("八年后端，支付方向");
    expect(view?.truncated).toBe(false);
    expect(view?.skills).toEqual(["Go", "K8s", "MySQL", "Redis", "Kafka", "gRPC"]);
  });

  it("summary 超过 80 字被截断并标记 truncated", () => {
    const view = resumeProfilePreview({
      summary: "长".repeat(120),
      skills: [],
      experiences: [],
      projects: [],
    });
    expect(view?.summary).toHaveLength(80);
    expect(view?.truncated).toBe(true);
  });

  it("非技能字符串被过滤", () => {
    const view = resumeProfilePreview({
      summary: "s",
      skills: ["Go", 42, null, "K8s"],
      experiences: [],
      projects: [],
    });
    expect(view?.skills).toEqual(["Go", "K8s"]);
  });

  it("null / 数组 / 形状不符一律视为未生成", () => {
    expect(resumeProfilePreview(null)).toBeNull();
    expect(resumeProfilePreview([1, 2])).toBeNull();
    expect(resumeProfilePreview("structured")).toBeNull();
    expect(resumeProfilePreview({})).toBeNull();
    expect(resumeProfilePreview({ summary: 123, skills: [] })).toBeNull();
    expect(resumeProfilePreview({ summary: "ok" })).toBeNull();
  });
});

describe("resumeRawExcerpt", () => {
  it("null / undefined / 空白输入：空摘录且不标记截断", () => {
    expect(resumeRawExcerpt(null)).toEqual({ text: "", truncated: false });
    expect(resumeRawExcerpt(undefined)).toEqual({ text: "", truncated: false });
    expect(resumeRawExcerpt("  \n\t ")).toEqual({ text: "", truncated: false });
  });

  it("空白归一：换行与连续空格折叠为单空格", () => {
    const view = resumeRawExcerpt("张三\n  后端工程师\t\n八年经验");
    expect(view.text).toBe("张三 后端工程师 八年经验");
    expect(view.truncated).toBe(false);
  });

  it("恰好等于 limit：不截断；超一字：截断并标记", () => {
    const exact = resumeRawExcerpt("字".repeat(400));
    expect(exact.text).toHaveLength(400);
    expect(exact.truncated).toBe(false);
    const over = resumeRawExcerpt("字".repeat(401));
    expect(over.text).toHaveLength(400);
    expect(over.truncated).toBe(true);
  });

  it("自定义 limit 生效", () => {
    const view = resumeRawExcerpt("abcdefghij", 5);
    expect(view).toEqual({ text: "abcde", truncated: true });
  });
});
