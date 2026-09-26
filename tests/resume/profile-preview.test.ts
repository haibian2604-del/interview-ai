import { describe, expect, it } from "vitest";
import { resumeProfilePreview } from "@/lib/resume/profile-preview";

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
