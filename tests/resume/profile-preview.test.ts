import { describe, expect, it } from "vitest";
import {
  isMarkdownResume,
  resumeProfilePreview,
  resumeRawExcerpt,
  stripMarkdown,
} from "@/lib/resume/profile-preview";

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

describe("isMarkdownResume（按原件路径判定）", () => {
  it(".md 不分大小写命中，pdf/粘贴（null）不命中", () => {
    expect(isMarkdownResume("u/abc.MD")).toBe(true);
    expect(isMarkdownResume("u/abc.markdown")).toBe(true);
    expect(isMarkdownResume("u/abc.pdf")).toBe(false);
    expect(isMarkdownResume(null)).toBe(false);
  });
});

describe("stripMarkdown（纯文本摘录的轻量去标记）", () => {
  it("标题/列表符/强调/行内代码剥离", () => {
    const md = "# 个人简历\n## 基本信息\n- **姓名**：甘某\n* 城市：广州\n`Java` 开发";
    expect(stripMarkdown(md)).toBe("个人简历\n基本信息\n姓名：甘某\n城市：广州\nJava 开发");
  });

  it("链接取文本、图片取 alt、转义符还原", () => {
    const md = "邮箱：[\\_2604@qq\\.com](mailto:_2604@qq.com)\n![头像](a.png)";
    expect(stripMarkdown(md)).toContain("_2604@qq.com");
    expect(stripMarkdown(md)).toContain("头像");
    expect(stripMarkdown(md)).not.toContain("mailto:");
    expect(stripMarkdown(md)).not.toContain("\\_");
  });

  it("代码围栏保留内容、有序列表符剥离", () => {
    const md = "1. 第一步\n```js\nconst a = 1;\n```\n正文";
    const out = stripMarkdown(md);
    expect(out).toContain("const a = 1;");
    expect(out).not.toContain("```");
    expect(out).toContain("第一步");
  });
});
