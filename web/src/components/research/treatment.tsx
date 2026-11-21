import { AlertTriangle, CircleAlert, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import type { Treatment } from "@/lib/types";

// How later judgments in the library treat a case. A signal to read the citing paragraph, never a verdict.
export function TreatmentBadges({ t, compact }: { t?: Partial<Treatment> | null; compact?: boolean }) {
  if (!t) return null;
  return (
    <>
      {!!t.negative && <Badge tone="tape" title="Later judgments in your library may have overruled or disapproved this case. Read the citing paragraphs."><AlertTriangle className="h-3 w-3" />{compact ? t.negative : `May be overruled · ${t.negative}`}</Badge>}
      {!!t.caution && <Badge tone="amber" title="Later judgments distinguished, doubted or explained this case."><CircleAlert className="h-3 w-3" />{compact ? t.caution : `Distinguished or doubted · ${t.caution}`}</Badge>}
      {!!t.positive && <Badge tone="leaf" title="Later judgments followed or relied on this case."><ThumbsUp className="h-3 w-3" />{compact ? t.positive : `Followed · ${t.positive}`}</Badge>}
    </>
  );
}

export function TreatmentWord({ value }: { value?: string }) {
  if (value === "negative") return <Badge tone="tape"><AlertTriangle className="h-3 w-3" />May be overruled</Badge>;
  if (value === "caution") return <Badge tone="amber">Distinguished or doubted</Badge>;
  if (value === "positive") return <Badge tone="leaf">Followed</Badge>;
  return null;
}
