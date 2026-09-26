/**
 * 校验登录后回跳目标（B9）：只放行站内绝对路径。
 * - 必须以 "/" 开头（挡掉 "https://evil.com" 等绝对 URL 与相对路径）
 * - 第二个字符不能是 "/" 或 "\\"（挡掉协议相对地址 "//evil.com" 与 "/\\evil.com"）
 * 合法返回原样路径，非法返回 null（调用方回落 /dashboard）。
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}
