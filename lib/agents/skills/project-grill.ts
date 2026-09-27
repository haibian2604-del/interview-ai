import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 「项目题问穿」技能加载器（ZCode skill 规范工件：skills/project-grill/）。
 * SKILL.md 是唯一事实来源——frontmatter 为元数据（name/description），
 * references/ 下的文档即注入产品提示词的载荷；本模块只做读取、解析与代入。
 * 路径用字面量 + next.config 的 outputFileTracingIncludes 显式打包，
 * 防止 Vercel 文件追踪漏掉运行时 fs 读取的 markdown（读不到即抛错，宁响铃不带静默降级）。
 */

const SKILL_ROOT = "skills/project-grill";

export const PROJECT_GRILL = { id: "project-grill", name: "项目题问穿" } as const;

/** 仅真实面试的项目题启用（practice 一次性出卷与非项目题维持通用链路） */
export function isProjectGrillApplicable(mode: string, questionType: string): boolean {
  return mode === "real" && questionType === "project";
}

function readSkillFile(rel: string): string {
  return readFileSync(path.join(process.cwd(), SKILL_ROOT, rel), "utf8");
}

/** 极简 frontmatter 解析：仅支持 name/description 单行字段，不引 YAML 依赖 */
function parseFrontmatter(raw: string): { name: string; description: string; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!match) throw new Error("project-grill skill: SKILL.md 缺少 frontmatter");
  const field = (key: string) => {
    const m = new RegExp(`^${key}: (.+)$`, "m").exec(match[1]);
    if (!m) throw new Error(`project-grill skill: frontmatter 缺少 ${key}`);
    return m[1].trim();
  };
  return { name: field("name"), description: field("description"), body: match[2] };
}

let skillCache: { name: string; description: string; body: string } | null = null;

/** SKILL.md 元数据（模块级缓存；dev 热更会重载模块，缓存生命周期安全） */
export function getProjectGrillSkill() {
  skillCache ??= parseFrontmatter(readSkillFile("SKILL.md"));
  return skillCache;
}

/** 出题契约：references/question-contract.md 全文，注入 real 单题生成提示词 */
export function projectGrillQuestionContract(): string {
  return readSkillFile("references/question-contract.md").trim();
}

/** 追问指令：references/followup-directives.md「## 模板」段中的围栏模板，代入锚点与评估不足 */
export function projectGrillFollowupDirectives(input: {
  anchor: string;
  improvements: string;
}): string {
  const section = extractSection(readSkillFile("references/followup-directives.md"), "模板");
  const fenced = /```[a-z]*\n([\s\S]*?)```/.exec(section);
  if (!fenced) throw new Error("project-grill skill: 模板段缺少代码围栏");
  return fenced[1]
    .trim()
    .replaceAll("{{anchor}}", input.anchor)
    .replaceAll("{{improvements}}", input.improvements);
}

/** 取「## <heading>」到下一个二级标题（或文末）之间的内容 */
function extractSection(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) throw new Error(`project-grill skill: 缺少「## ${heading}」段`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n").trim();
}
