// Plain-language meaning of each citation-check status from app/services/citations.py.
export type Tone = "leaf" | "amber" | "tape" | "neutral" | "cyan";
export const STATUS: Record<string, { label: string; tone: Tone; explain: string }> = {
  VERIFIED: { label: "Verified", tone: "leaf", explain: "Found in your library and the paragraph supports the point." },
  EXISTS_UNCHECKED: { label: "Found, not yet checked", tone: "amber", explain: "The judgment exists in your library. Read the matched paragraph to confirm it supports the point." },
  EXISTS_NOT_SUPPORTED: { label: "Does not support the point", tone: "tape", explain: "The judgment exists, but the matched paragraphs do not seem to say what the draft claims." },
  CITATION_MISMATCH: { label: "Citation does not match", tone: "tape", explain: "The citation points to a different case than the name in the draft." },
  NOT_IN_LIBRARY: { label: "Not in your library", tone: "neutral", explain: "Not wrong by itself: most SCC and AIR reports are not in open data. Check it on Indian Kanoon or SCC Online." },
  FOUND_EXTERNALLY: { label: "Found on Indian Kanoon", tone: "cyan", explain: "Not in your library, but found through the Indian Kanoon API. Read it before relying on it." },
};
export const statusMeta = (s: string) => STATUS[s] ?? { label: s.replace(/_/g, " ").toLowerCase(), tone: "neutral" as Tone, explain: "" };
