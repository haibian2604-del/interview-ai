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
