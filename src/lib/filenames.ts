// Make a Gmail filename safe for every OS, and unique within one ZIP.

const ILLEGAL = /[\/\\:*?"<>|\x00-\x1f\x7f]/g;
// Invisible and right-to-left marks, which can disguise "invoice\u202Efdp.exe" as "invoiceexe.pdf".
const BIDI = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
// Names Windows won't create, with or without an extension.
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;
const trim = (s: string) => s.replace(/^[.\s]+|[.\s]+$/g, "");

export function sanitizeFilename(name: string): string {
  const clean = trim([...trim(name.normalize("NFC").replace(BIDI, "").replace(ILLEGAL, "_"))].slice(0, 200).join(""));
  if (!clean) return "attachment";
  return RESERVED.test(clean) ? `_${clean}` : clean;
}

export function uniqueFilenames(names: string[], reserved: string[] = []): string[] {
  const used = new Set(reserved.map((n) => n.toLowerCase()));
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
