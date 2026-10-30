// HTMLRewriter text and attribute values retain entity references. Decode once
// before re-encoding into new attributes or serializing plain-text JSON-LD.
export function metadataText(value: string): string {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: "\u00a0" };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, key: string) => {
    if (!key.startsWith("#")) return named[key.toLowerCase()] ?? entity;
    const point = key.slice(0, 2).toLowerCase() === "#x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "\ufffd";
  });
}
