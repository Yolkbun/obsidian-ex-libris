/** YAML / frontmatter 文本操作（只处理我们自己写的扁平键值，不实现通用 YAML）。 */

const NEEDS_QUOTE = /[:#\[\]{}",'&*!|>%@`\n\r\t]/;

/** 标量转 YAML。纯数字字符串加引号，避免 fq_book_id 变成数字。 */
export function yamlScalar(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = value;
  if (text === "") return '""';
  // ISO 日期/时间保持裸值，frontmatter 里更像人写的
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(text)) {
    return text;
  }
  if (/^[0-9]+$/.test(text) || NEEDS_QUOTE.test(text) || /^\s|\s$/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

export type FrontmatterValue = string | number | boolean | null | undefined | string[];

export function splitFrontmatter(text: string): { frontmatter: string | null; body: string } {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return { frontmatter: null, body: text };
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { frontmatter: null, body: text };
  return { frontmatter: match[1]!, body: text.slice(match[0].length) };
}

/** 生成完整 frontmatter 文本（保持写死的键顺序，方便人读与 diff）。 */
export function buildFrontmatter(
  fields: Record<string, FrontmatterValue>,
  order: string[] = [],
): string {
  const keys = [
    ...order.filter((k) => k in fields),
    ...Object.keys(fields).filter((k) => !order.includes(k)),
  ];
  const lines = keys.map((key) => {
    const value = fields[key];
    if (Array.isArray(value)) {
      return `${key}: [${value.map((entry) => yamlScalar(String(entry))).join(", ")}]`;
    }
    return `${key}: ${yamlScalar(value)}`;
  });
  return `---\n${lines.join("\n")}\n---\n`;
}

export function parseFrontmatter(text: string): Record<string, string> {
  const { frontmatter } = splitFrontmatter(text);
  if (!frontmatter) return {};
  const result: Record<string, string> = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    result[match[1]!] = value;
  }
  return result;
}

/**
 * 只改指定键，保留其余行、注释与正文；缺失的键追加到 frontmatter 末尾。
 * 用于给番茄轻笔记补写阅读摘要（绝不整块重写用户笔记）。
 */
export function patchFrontmatter(
  text: string,
  patch: Record<string, string | number | null | undefined>,
): string {
  const { frontmatter, body } = splitFrontmatter(text);
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as Array<
    [string, string | number | null]
  >;
  if (entries.length === 0) return text;

  if (frontmatter === null) {
    const fields: Record<string, string | number | null> = {};
    for (const [key, value] of entries) fields[key] = value;
    return buildFrontmatter(fields) + text;
  }

  const lines = frontmatter.split(/\r?\n/);
  const remaining = new Map(entries);
  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z0-9_-]+):/.exec(lines[i]!);
    if (!match) continue;
    const key = match[1]!;
    if (!remaining.has(key)) continue;
    lines[i] = `${key}: ${yamlScalar(remaining.get(key))}`;
    remaining.delete(key);
  }
  for (const [key, value] of remaining) {
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

/** 摘录正文截断，最多 max 个字符（按 Unicode 码点，不撕代理对）。 */
export function truncateText(text: string, max: number): { text: string; truncated: boolean } {
  const chars = Array.from(text);
  if (chars.length <= max) return { text, truncated: false };
  return { text: chars.slice(0, max).join(""), truncated: true };
}

/** 多段纯文本 → 单个 Markdown 引用块里的多行（每行加 "> "）。 */
export function quoteLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
