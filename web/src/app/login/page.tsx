"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ErrorNote } from "@/components/ui/misc";
import { Logo } from "@/components/brand/logo";
import { spring } from "@/lib/motion";
import { shake } from "@/components/shell/specular";

type Mode = "login" | "setup" | "invite";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const invite = params.get("invite");
  const next = params.get("next") || "/";
  const status = useQuery({ queryKey: ["auth-status"], queryFn: () => api.get<{ has_users: boolean }>("/auth/status") });
  const inviteInfo = useQuery({ queryKey: ["invite", invite], enabled: !!invite, queryFn: () => api.get<{ email: string; role: string; firm: string }>(`/auth/invite/${invite}`) });
  const mode: Mode = invite ? "invite" : status.data && !status.data.has_users ? "setup" : "login";

  const [f, setF] = useState({ firm_name: "", name: "", email: "", password: "", enrolment_no: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const card = useRef<HTMLDivElement>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { setErr(null); }, [mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
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

  const heading = mode === "setup" ? "Set up your chambers" : mode === "invite" ? `Join ${inviteInfo.data?.firm ?? "your chambers"}` : "Sign in";
  const sub = mode === "setup" ? "You will be the owner. Invite colleagues after this." : mode === "invite" ? `You were invited as ${inviteInfo.data?.role ?? "a member"} with ${inviteInfo.data?.email ?? "your email"}.` : "Welcome back.";

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex">
        <Logo className="h-9" />
        {/* The one orchestrated moment: the seal is lit, then the light settles into rings. */}
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-[46%] grid -translate-x-1/2 -translate-y-1/2 place-items-center">
          {[520, 400, 290, 190].map((d, i) => (
            <motion.span key={d} className="absolute rounded-full border border-brass/20"
              style={{ width: d, height: d, boxShadow: i === 3 ? "0 0 80px -20px var(--brass), inset 0 0 60px -30px var(--brass)" : undefined }}
              initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1 - i * 0.05 - 0.45 + i * 0.15, scale: 1 }}
              transition={{ ...spring.gentle, delay: 0.35 + (3 - i) * 0.12 }} />
          ))}
          <motion.span className="absolute h-[340px] w-[340px] rounded-full bg-brass/10 blur-3xl"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.4, delay: 0.2 }} />
          <motion.div initial={{ opacity: 0, scale: 0.85, filter: "blur(8px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} transition={{ ...spring.gentle, delay: 0.1 }}>
            <Logo variant="full" alt="" className="h-[150px]" />
          </motion.div>
        </div>
        <motion.div className="relative max-w-md" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.gentle, delay: 1.1 }}>
          <p className="font-editorial text-[2.6rem] leading-[1.08] text-text">Every authority, checked.</p>
          <p className="mt-4 text-md text-muted">Research Supreme Court and High Court judgments to the paragraph, track every matter and deadline, and file drafts only after each citation is verified. Everything runs on your computer.</p>
        </motion.div>
      </section>
      <section className="flex items-center justify-center p-6">
        <div ref={card} className="w-full max-w-[420px]">
        <motion.form onSubmit={submit} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          className="glass-4 w-full max-w-[420px] space-y-5 rounded-2xl p-8 [&>*]:relative [&>*]:z-[3]">
          <div className="lg:hidden"><Logo className="h-9" /></div>
          <div>
            <h1 className="font-editorial text-2xl">{heading}</h1>
            <p className="mt-1 text-base text-muted">{sub}</p>
          </div>
          {inviteInfo.isError && <ErrorNote error={inviteInfo.error} />}
          {mode === "setup" && <Field label="Chambers or firm name"><Input required value={f.firm_name} onChange={set("firm_name")} autoComplete="organization" /></Field>}
          {mode !== "login" && <Field label="Your name"><Input required value={f.name} onChange={set("name")} autoComplete="name" /></Field>}
          {mode !== "invite" && <Field label="Email"><Input required type="email" value={f.email} onChange={set("email")} autoComplete="email" /></Field>}
          <Field label="Password" hint={mode !== "login" ? "At least 10 characters." : undefined}>
            <Input required type="password" value={f.password} onChange={set("password")} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "login" ? 1 : 10} />
          </Field>
          {mode !== "login" && <Field label="Bar enrolment number" hint="Needed to approve AI proposals and sign off legal rules. Clerks can leave this empty.">
            <Input value={f.enrolment_no} onChange={set("enrolment_no")} placeholder="MAH/1234/2020" />
          </Field>}
          <ErrorNote error={err} />
          <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={busy} disabled={status.isLoading || (mode === "invite" && !inviteInfo.data)}>
            {mode === "setup" ? "Create chambers" : mode === "invite" ? "Join chambers" : "Sign in"}
          </Button>
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
