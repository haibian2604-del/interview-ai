"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import { COPY } from "@/lib/copy";

const DIMENSION_KEYS = ["relevance", "depth", "structure", "communication"] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

/**
 * 与目标的差距文案（先偏差后数值）：差距 = 100 − 分值，按档位给一句批语。
 * 语义顺序固定：先差距句（红墨批注），后数值（等宽印刷数字）。
 */
function gapSentence(score: number): string {
  const copy = COPY.report;
  const gap = Math.max(0, Math.round(100 - score));
  const tier =
    gap <= 10
      ? copy.gapClose
      : gap <= 25
        ? copy.gapNear
        : gap <= 40
          ? copy.gapMid
          : copy.gapFar;
  return `${copy.gapPrefix} ${gap} ${copy.gapUnit}，${tier}`;
}

/**
 * 四维雷达（阅卷完成的评分簿一页）：
 * - recharts RadarChart，PolarRadiusAxis domain [0,100]，四维中文标签取 COPY.interview.dimensions；
 * - 刻度贴合评分簿气质：hairline 细线网格、等宽小字刻度、黑墨标签；
 * - Radar 指针阻尼转动：缓出动画落定（无回弹），红批改油墨；
 * - 图侧逐维「先偏差后数值」批注栏（差距句 → 分值）。
 */
/* 与 globals.css 的 token 同值：recharts 以 SVG 属性下色，attribute 不支持 var()，
   故在文件内单源化，改 token 时需同步此处 */
const RADAR_INK = "#21201d";
const RADAR_PENCIL = "#6f6e68";
const RADAR_RED = "#a63a2f";

export function ScoreRadar({
  dimensionScores,
}: {
  dimensionScores: Record<DimensionKey, number>;
}) {
  const copy = COPY.report;
  const data = DIMENSION_KEYS.map((key) => ({
    dim: COPY.interview.dimensions[key],
    value: dimensionScores[key],
  }));

  return (
    <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
      {/* 雷达图：细线网格 + 黑墨维度标签 + 红墨多边形阻尼落定 */}
      <div className="h-72 w-full">
        <div role="img" aria-label={COPY.report.radarAriaLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="70%" margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <PolarGrid stroke={RADAR_INK} strokeOpacity={0.18} strokeWidth={1} />
            <PolarAngleAxis
              dataKey="dim"
              tick={{ fill: RADAR_INK, fontSize: 12, fontFamily: "var(--font-sans)" }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tickCount={5}
              tick={{ fill: RADAR_PENCIL, fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: "#21201d", strokeOpacity: 0.18, strokeWidth: 1 }}
            />
            <Radar
              dataKey="value"
              stroke={RADAR_RED}
              strokeWidth={1.5}
              fill={RADAR_RED}
              fillOpacity={0.1}
              animationDuration={1100}
              animationEasing="ease-out"
            />
          </RadarChart>
        </ResponsiveContainer>
        </div>
      </div>

      {/* 批注栏：每维先差距句（红墨）后分值（等宽印刷数字），语义顺序不可换 */}
      <div>
        <p className="font-mono text-[10px] tracking-[0.35em] text-pencil">{copy.radarHint}</p>
        <dl className="mt-2">
          {DIMENSION_KEYS.map((key) => (
            <div
              key={key}
              className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-t border-ink/15 py-2.5"
            >
              <dt className="font-heading text-sm font-semibold">
                {COPY.interview.dimensions[key]}
              </dt>
              <dd className="text-xs leading-5 text-ink-red">{gapSentence(dimensionScores[key])}</dd>
              <dd className="font-mono text-xl tabular-nums">{Math.round(dimensionScores[key])}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
