// Make a Gmail filename safe for every OS, and unique within one ZIP.

const ILLEGAL = /[\/\\:*?"<>|\x00-\x1f\x7f]/g;

export function sanitizeFilename(name: string): string {
  const clean = name.replace(ILLEGAL, "_").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 200);
  return clean || "attachment";
}

export function uniqueFilenames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const name = sanitizeFilename(raw);
    if (!used.has(name.toLowerCase())) {
      used.add(name.toLowerCase());
      return name;
    }
    const dot = name.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    for (let n = 2; ; n++) {
      const candidate = `${stem} (${n})${ext}`;
      if (!used.has(candidate.toLowerCase())) {
        used.add(candidate.toLowerCase());
        return candidate;
      }
    }
  });
}
