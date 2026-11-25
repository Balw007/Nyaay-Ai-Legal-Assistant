"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ErrorNote, Segmented } from "@/components/ui/misc";
import { CheckCircle2, KeyRound, Link2 } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { spring } from "@/lib/motion";
import { shake } from "@/components/shell/specular";
import { Ribbon } from "@/components/fx/ribbon";
import { Sharpen } from "@/components/fx/motion-bits";
import { DeadlineCard } from "@/components/fx/deadline-card";

type Mode = "login" | "request" | "setup" | "invite";

/** Pull the invite code out of a pasted link ("...login?invite=abc") or accept the bare code. */
function inviteToken(v: string) {
  const t = v.trim();
  const m = t.match(/[?&]invite=([^&#\s]+)/);
  return m ? decodeURIComponent(m[1]) : /^[\w-]{16,}$/.test(t) ? t : "";
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const invite = params.get("invite");
  const next = params.get("next") || "/";
  const status = useQuery({ queryKey: ["auth-status"], queryFn: () => api.get<{ has_users: boolean }>("/auth/status") });
  const inviteInfo = useQuery({ queryKey: ["invite", invite], enabled: !!invite, queryFn: () => api.get<{ email: string; role: string; firm: string }>(`/auth/invite/${invite}`) });
  const [tab, setTab] = useState<"login" | "request">("login");
  const mode: Mode = invite ? "invite" : status.data && !status.data.has_users ? "setup" : tab;

  const [f, setF] = useState({ firm_name: "", name: "", email: "", password: "", enrolment_no: "", message: "" });
  const [sent, setSent] = useState<string | null>(null);
  const [help, setHelp] = useState<"invite" | "forgot" | null>(null);
  const [paste, setPaste] = useState("");
  const [pasteErr, setPasteErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const card = useRef<HTMLDivElement>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { setErr(null); setSent(null); }, [mode]);

  const openInvite = () => {
    const t = inviteToken(paste);
    if (!t) { setPasteErr("Paste the whole invite link you were sent, or its code."); return; }
    setPasteErr(null);
    router.push(`/login?invite=${encodeURIComponent(t)}`);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (mode === "request") {
        const r = await api.post<{ message: string }>("/auth/request-access", { name: f.name, email: f.email, password: f.password, enrolment_no: f.enrolment_no || null, message: f.message || null });
        setSent(r.message);
        return;
      }
      if (mode === "setup") await api.post("/auth/setup", { ...f, demo: false });
      else if (mode === "invite") await api.post("/auth/accept", { token: invite, name: f.name, password: f.password, enrolment_no: f.enrolment_no || null });
      else await api.post("/auth/login", { email: f.email, password: f.password });
      await qc.invalidateQueries();
      router.replace(mode === "setup" ? "/library" : next);
    } catch (x) {
      setErr(x instanceof ApiError ? x : new Error("Could not reach the Nyaay server. Is it running?"));
      shake(card.current);
    } finally { setBusy(false); }
  }

  const heading = mode === "setup" ? "Set up your chambers" : mode === "invite" ? `Join ${inviteInfo.data?.firm ?? "your chambers"}` : mode === "request" ? "Request access" : "Sign in";
  const sub = mode === "setup" ? "You will be the owner. Invite colleagues after this." : mode === "invite" ? `You were invited as ${inviteInfo.data?.role ?? "a member"} with ${inviteInfo.data?.email ?? "your email"}.`
    : mode === "request" ? "New to these chambers? Ask to join. An admin approves every new account." : "Welcome back.";

  return (
    <div className="relative isolate grid min-h-screen overflow-hidden lg:grid-cols-[1.15fr_1fr]">
      <div aria-hidden className="absolute inset-0 z-0"><Ribbon shape="login" /></div>
      <section className="relative z-[1] hidden flex-col justify-between gap-8 p-12 lg:flex">
        <Logo className="h-9" />
        <div className="max-w-xl">
          <p className="login-headline font-editorial text-text"><Sharpen text="Every authority, checked." delay={0.15} /></p>
          <motion.p className="short-hide mt-5 max-w-lg text-md text-muted" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.gentle, delay: 0.6 }}>
            Research Supreme Court and High Court judgments to the paragraph, track every matter and deadline, and file drafts only after each citation is verified. Everything runs on your computer.
          </motion.p>
          <div className="mt-9"><DeadlineCard /></div>
        </div>
        <p className="short-hide text-sm text-faint">AI proposes, an advocate decides.</p>
      </section>
      <section className="relative z-[1] flex items-center justify-center p-6">
        <div ref={card} className="w-full max-w-[420px]">
        <motion.form onSubmit={submit} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          className="glass-4 login-card w-full max-w-[420px] space-y-5 rounded-2xl p-8 [&>*]:relative [&>*]:z-[3]">
          <div className="lg:hidden"><Logo className="h-9" /></div>
          {(mode === "login" || mode === "request") && (
            <Segmented label="Sign in or request access" value={tab} onChange={setTab} className="w-full [&>button]:flex-1 [&>button]:justify-center"
              items={[{ value: "login", label: "Sign in" }, { value: "request", label: "Request access" }]} />
          )}
          <div>
            <h1 className="font-editorial text-2xl">{heading}</h1>
            <p className="mt-1 text-base text-muted">{sub}</p>
          </div>
          {inviteInfo.isError && <ErrorNote error={inviteInfo.error} />}
          {mode === "setup" && <Field label="Chambers or firm name"><Input required value={f.firm_name} onChange={set("firm_name")} autoComplete="organization" /></Field>}
          {sent ? (
            <div role="status" className="space-y-3 rounded-xl border border-leaf/30 bg-leaf-soft p-4">
              <p className="flex items-center gap-2 font-medium text-leaf"><CheckCircle2 className="h-4 w-4" />Request sent</p>
              <p className="text-sm text-muted">{sent}</p>
              <Button type="button" variant="secondary" onClick={() => { setTab("login"); setSent(null); }}>Back to sign in</Button>
            </div>
          ) : (<>
          {mode !== "login" && <Field label="Your name"><Input required value={f.name} onChange={set("name")} autoComplete="name" /></Field>}
          {mode !== "invite" && <Field label="Email"><Input required type="email" value={f.email} onChange={set("email")} autoComplete="email" /></Field>}
          <Field label="Password" hint={mode !== "login" ? "At least 10 characters." : undefined}>
            <Input required type="password" value={f.password} onChange={set("password")} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "login" ? 1 : 10} />
          </Field>
          {mode !== "login" && <Field label="Bar enrolment number" hint="Needed to approve AI proposals and sign off legal rules. Clerks can leave this empty.">
            <Input value={f.enrolment_no} onChange={set("enrolment_no")} placeholder="MAH/1234/2020" />
          </Field>}
          {mode === "request" && <Field label="Note to the admin" hint="Optional. For example, who you are and who asked you to join.">
            <Textarea rows={2} maxLength={500} value={f.message} onChange={set("message")} />
          </Field>}
          <ErrorNote error={err} />
          <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={busy} disabled={status.isLoading || (mode === "invite" && !inviteInfo.data)}>
            {mode === "setup" ? "Create chambers" : mode === "invite" ? "Join chambers" : mode === "request" ? "Send request" : "Sign in"}
          </Button>
          </>)}
          {(mode === "login" || mode === "request") && !sent && (
            <div className="space-y-3 border-t border-rule pt-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <button type="button" onClick={() => setHelp(help === "invite" ? null : "invite")} aria-expanded={help === "invite"}
                  className="inline-flex items-center gap-1.5 text-brass hover:underline"><Link2 className="h-3.5 w-3.5" />Have an invite link?</button>
                {mode === "login" && <button type="button" onClick={() => setHelp(help === "forgot" ? null : "forgot")} aria-expanded={help === "forgot"}
                  className="inline-flex items-center gap-1.5 text-muted hover:text-text hover:underline"><KeyRound className="h-3.5 w-3.5" />Forgot password?</button>}
              </div>
              {help === "invite" && (
                <div className="space-y-2">
                  <Field label="Invite link or code" error={pasteErr}>
                    <Input value={paste} onChange={(e) => { setPaste(e.target.value); setPasteErr(null); }} placeholder="Paste the link you were sent"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); openInvite(); } }} />
                  </Field>
                  <Button type="button" variant="secondary" onClick={openInvite}>Use invite</Button>
                </div>
              )}
              {help === "forgot" && (
                <p className="rounded-lg border border-rule bg-vellum p-3 text-muted">
                  Ask the owner or an admin of your chambers. They can set a temporary password for you in <b className="text-text">Settings → Team</b>.
                  After signing in, change it in <b className="text-text">Settings → Profile</b>.
                </p>
              )}
            </div>
          )}
          {status.isError && <ErrorNote error={new Error("The Nyaay server is not running. Start it, then reload this page.")} />}
        </motion.form>
        </div>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginInner /></Suspense>;
}
