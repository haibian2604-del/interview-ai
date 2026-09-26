import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Serif_SC } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// D7：宋体标题跨平台回退——Noto Serif SC 补齐无系统宋体（Windows/Linux 常见）的缺口。
// CJK 字体按 unicode-range 切片由浏览器按需下载，故 preload 关闭、display swap 防白屏。
// 变量挂到 --font-heading-serif，globals.css 的 --font-heading 栈以其为首，回落系统宋体。
const notoSerifSc = Noto_Serif_SC({
  weight: ["600", "700"],
  display: "swap",
  preload: false,
  variable: "--font-heading-serif",
});

export const metadata: Metadata = {
  title: "面镜 Mirror · AI 模拟面试",
  description: "照镜子式演练：面试是自我认知的镜子。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSerifSc.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
