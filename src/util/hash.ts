/** 稳定哈希：同一标题永远得到同一颜色。 */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 占位封面色：偏向低饱和的纸感色系。 */
export function hueForTitle(title: string): number {
  return fnv1a(title) % 360;
}

/** 占位封面首字（按字素切，避免把 emoji 撕成两半）。 */
export function initialForTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "?";
  const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
  if (segmenter) {
    const first = segmenter.segment(trimmed)[Symbol.iterator]().next();
    if (!first.done) return first.value.segment.toUpperCase();
  }
  return Array.from(trimmed)[0]!.toUpperCase();
}

/** 封面缓存文件名用 sha1；浏览器/Electron 的 WebCrypto 都能算。 */
export async function sha1Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
