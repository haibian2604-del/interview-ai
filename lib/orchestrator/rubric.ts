export const FOLLOWUP_THRESHOLD = 0.65;

export const DIMENSIONS = [
  "relevance",
  "depth",
  "structure",
  "communication",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const RUBRIC: Record<Dimension, string> = {
  relevance: "相关性：回答是否切题，是否回应了问题的核心考察点",
  depth: "深度：是否展示底层原理、权衡取舍、量化结果，而非停留在表面",
  structure: "结构化：是否条理清晰（如 STAR），有论点有论据",
  communication: "沟通：表达是否简洁准确、术语使用是否得当",
};
