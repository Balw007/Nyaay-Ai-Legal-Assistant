"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Download, FileText, OctagonX, Stethoscope } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge, ErrorNote, Panel, PanelHeader, Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

interface Check { status: "PASS" | "WARN" | "FAIL" | "INFO"; name: string; detail: string; fix: string }
interface CheckResult { results: Check[]; summary: { pass: number; warn: number; fail: number; ready: boolean; verdict: string }; full: boolean }

const ICON = { PASS: CheckCircle2, WARN: CircleAlert, FAIL: OctagonX, INFO: CircleAlert };
const TONE = { PASS: "text-leaf", WARN: "text-amber", FAIL: "text-tape", INFO: "text-muted" };

/** Runs the same checks as `python -m app.doctor`. Quick by default; the full test downloads one real judgment. */
export function SystemCheck({ admin }: { admin: boolean }) {
  const [full, setFull] = useState(false);
  const q = useQuery({
    queryKey: ["system-check", full], enabled: false, retry: false,
    queryFn: () => api.get<CheckResult>(`/system/check?full=${full}`),
  });
  const run = (f: boolean) => { setFull(f); setTimeout(() => q.refetch(), 0); };
  const d = q.data;
  return (
    <Panel>
      <PanelHeader title="System check" sub="Is this computer ready: AI models, OCR, open-data access, disk and ports."
        action={
          <div className="flex gap-2">
            <Button size="sm" disabled={!admin || q.isFetching} onClick={() => run(false)}><Stethoscope className="h-3.5 w-3.5" /> Quick check</Button>
            <Button size="sm" disabled={!admin || q.isFetching} onClick={() => run(true)}>Full test</Button>
          </div>
        } />
      <div className="p-4">
        {!admin && <p className="text-sm text-muted">Only an admin can run the system check.</p>}
        {q.isFetching && <Spinner label={full ? "Running the full test. This can take a minute or two" : "Checking"} />}
        {q.isError && <ErrorNote error={q.error} />}
        {!d && !q.isFetching && admin && !q.isError && <p className="text-sm text-muted">The quick check takes a few seconds. The full test also asks the AI a question and downloads one real judgment to show how it is cleaned.</p>}
        {d && !q.isFetching && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={d.summary.fail ? "tape" : d.summary.warn ? "amber" : "leaf"}>{d.summary.verdict}</Badge>
              <span className="text-sm text-muted">{d.summary.pass} passed, {d.summary.warn} to improve, {d.summary.fail} to fix</span>
            </div>
            <ul className="divide-y divide-rule rounded-md border border-rule">
              {d.results.map((c, i) => {
                const Icon = ICON[c.status];
                return (
                  <li key={i} className="flex gap-3 px-3 py-2.5">
                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", TONE[c.status])} aria-label={c.status} />
                    <div className="min-w-0 flex-1 text-sm">
                      <p><span className="font-medium">{c.name}</span> <span className="text-muted">{c.detail}</span></p>
                      {c.fix && c.status !== "PASS" && <p className="mt-1 break-words rounded bg-vellum px-2 py-1 font-mono text-xs">{c.fix}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** The rules and templates as one Word file for an advocate to read and sign. */
export function ReviewPackDownload() {
  return (
    <Panel className="flex flex-wrap items-center gap-4 p-4">
      <FileText className="h-5 w-5 text-brass" aria-hidden />
      <div className="min-w-[240px] flex-1">
        <p className="font-medium">Legal review pack</p>
        <p className="text-sm text-muted">Every deadline rule with worked date examples, every stage and every draft template, with tick boxes and a sign-off page. Give it to your advocate to review in one sitting.</p>
      </div>
      <a href="/api/system/review-pack?format=docx"><Button size="sm"><Download className="h-3.5 w-3.5" /> Word (.docx)</Button></a>
      <a href="/api/system/review-pack?format=md"><Button size="sm" variant="ghost">Text (.md)</Button></a>
    </Panel>
  );
}
