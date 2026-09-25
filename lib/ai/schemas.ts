import { z } from "zod";

const score01 = z.number().min(0).max(1);
const score100 = z.number().min(0).max(100);

export const ResumeProfileSchema = z.object({
  summary: z.string(),
  skills: z.array(z.string()),
  experiences: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      highlights: z.array(z.string()),
    }),
  ),
  projects: z.array(
    z.object({ name: z.string(), highlights: z.array(z.string()) }),
  ),
});
export type ResumeProfile = z.infer<typeof ResumeProfileSchema>;

export const QuestionSchema = z.object({
  content: z.string(),
  type: z.enum(["skill", "project", "behavioral"]),
  skillTag: z.string(),
  followupAnchor: z.string(),
});
export type Question = z.infer<typeof QuestionSchema>;

export const QuestionSetSchema = z.object({
  questions: z.array(QuestionSchema).min(1).max(10),
});

const evalScores = z.object({
  relevance: score01,
  depth: score01,
  structure: score01,
  communication: score01,
});

export const EvaluationSchema = z.object({
  scores: evalScores,
  starCompleteness: score01,
  strengths: z.string(),
  improvements: z.string(),
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

export const ReportSchema = z.object({
  overallScore: score100,
  dimensionScores: z.object({
    relevance: score100,
    depth: score100,
    structure: score100,
    communication: score100,
  }),
  summary: z.string(),
  strengths: z.string(),
  improvements: z.string(),
});
export type Report = z.infer<typeof ReportSchema>;

/** 纠错重试时给模型的逐字段结构骨架（字段名逐字、值仅示意） */
export const SCHEMA_SHAPE_HINTS = {
  resumeProfile:
    '{"summary":"一句话概述","skills":["技能"],"experiences":[{"company":"公司","title":"职位","highlights":["要点"]}],"projects":[{"name":"项目名","highlights":["要点"]}]}',
  questionSet:
    '{"questions":[{"content":"题目原文","type":"skill 或 project 或 behavioral 之一","skillTag":"考察点","followupAnchor":"值得追问的具体方向"}]}',
  evaluation:
    '{"scores":{"relevance":0.8,"depth":0.6,"structure":0.7,"communication":0.9},"starCompleteness":0.5,"strengths":"亮点","improvements":"不足与具体改法"}',
  report:
    '{"overallScore":85,"dimensionScores":{"relevance":80,"depth":70,"structure":90,"communication":75},"summary":"总结","strengths":"优势","improvements":"改进"}',
} as const;
