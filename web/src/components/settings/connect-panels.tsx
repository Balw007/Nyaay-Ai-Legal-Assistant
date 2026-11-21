"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarPlus, Copy, Send } from "lucide-react";
import { api } from "@/lib/api";
import type { TelegramStatus } from "@/lib/types";
import { isAdmin, useMe } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Badge, ErrorNote, Panel, PanelHeader } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

const toastErr = (e: unknown) => toast.error((e as Error).message);

function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 py-2", disabled && "opacity-60")}>
      <span><span className="block text-base">{label}</span>{hint && <span className="block text-sm text-faint">{hint}</span>}</span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors", checked ? "border-brass bg-brass" : "border-rule-strong bg-vellum")}>
        <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
      </button>
    </div>
  );
}

export function TelegramCard() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const admin = isAdmin(me?.user.role);
  const st = useQuery({ queryKey: ["telegram"], queryFn: () => api.get<TelegramStatus>("/integrations/telegram") });
  const [token, setToken] = useState("");
  const [chat, setChat] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["telegram"] }); qc.invalidateQueries({ queryKey: ["me"] }); };
  const saveToken = useMutation({ mutationFn: () => api.put<TelegramStatus>("/integrations/telegram", { bot_token: token.trim() }), onSuccess: () => { setToken(""); toast.success("Telegram bot connected"); refresh(); }, onError: toastErr });
  const removeToken = useMutation({ mutationFn: () => api.del("/integrations/telegram"), onSuccess: () => { toast.success("Bot removed"); refresh(); }, onError: toastErr });
  const chats = useMutation({ mutationFn: () => api.get<{ chats: { id: string; name: string; username: string | null }[] }>("/integrations/telegram/chats"), onError: toastErr });
  const saveProfile = useMutation({ mutationFn: (b: Record<string, unknown>) => api.patch("/auth/me", b), onSuccess: () => { toast.success("Saved"); refresh(); }, onError: toastErr });
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; results: Record<string, { ok?: boolean; error?: string; skipped?: string }> }>("/brief/test", { channel: "telegram" }),
    onSuccess: (r) => { const x = r.results.telegram; r.ok ? toast.success("Test brief sent. Check Telegram.") : toast.error(x?.error ?? x?.skipped ?? "Could not send"); },
    onError: toastErr,
  });
  const s = st.data;
  const chatId = s?.chat_id ?? "";

  return (
    <Panel className="self-start">
      <PanelHeader title="Morning brief on Telegram" sub="Today's hearings and deadlines at 8 am IST, every day." action={s?.configured ? <Badge tone="leaf">Bot connected{s.bot_username ? ` · @${s.bot_username}` : ""}</Badge> : <Badge>Not connected</Badge>} />
      <div className="space-y-4 p-4">
        <ErrorNote error={st.error} />
        {s?.error && <p className="text-sm text-tape">{s.error}</p>}
        {admin && (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); saveToken.mutate(); }}>
            <Field label="Bot token" hint={s?.source === "firm" ? `Saved (${s.token_hint}). Paste a new one to replace it.` : s?.source === "server" ? "This server already has a bot token set. You can still use your own." : "Create a bot with @BotFather in Telegram and paste its token."}>
              <Input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AAH…" />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" size="sm" disabled={!token.trim()} loading={saveToken.isPending}>Connect bot</Button>
              {s?.source === "firm" && <Button type="button" size="sm" variant="ghost" onClick={() => confirm("Remove the Telegram bot? Nobody will receive briefs there.") && removeToken.mutate()}>Remove</Button>}
            </div>
          </form>
        )}
        {!admin && !s?.configured && <p className="text-sm text-muted">An admin needs to connect the firm's Telegram bot first.</p>}
        {s?.configured && (
          <div className="space-y-3 border-t border-rule pt-4">
            <p className="text-sm text-muted">Open the bot in Telegram, press Start, send it any message, then find your chat below.</p>
            <div className="flex flex-wrap items-end gap-2">
              <Button size="sm" onClick={() => chats.mutate()} loading={chats.isPending}>Find my chat</Button>
              {chats.data && (chats.data.chats.length ? (
                <Select aria-label="Choose your Telegram chat" className="h-8 w-auto" value={chat} onChange={(e) => { setChat(e.target.value); if (e.target.value) saveProfile.mutate({ telegram_chat_id: e.target.value }); }}>
                  <option value="">Choose your chat…</option>
                  {chats.data.chats.map((c) => <option key={c.id} value={c.id}>{c.name || c.username || c.id}</option>)}
                </Select>
              ) : <span className="text-sm text-amber">No messages found. Send the bot a message and try again.</span>)}
            </div>
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); saveProfile.mutate({ telegram_chat_id: chat || chatId }); }}>
              <Field label="Chat ID" className="flex-1"><Input value={chat || chatId} onChange={(e) => setChat(e.target.value)} inputMode="numeric" placeholder="e.g. 123456789" /></Field>
              <Button size="sm" loading={saveProfile.isPending}>Save</Button>
            </form>
            <Switch checked={!!s.brief} disabled={!chatId} onChange={(v) => saveProfile.mutate({ telegram_brief: v })} label="Send me the brief every morning" hint={chatId ? "Sent once a day at 8 am IST." : "Save your chat ID first."} />
            <Button size="sm" variant="brass" disabled={!chatId} loading={test.isPending} onClick={() => test.mutate()}><Send className="h-3.5 w-3.5" /> Send test brief</Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

export function CalendarFeedCard() {
  const status = useQuery({ queryKey: ["calfeed"], queryFn: () => api.get<{ enabled: boolean }>("/calendar/feed") });
  const qc = useQueryClient();
  const [link, setLink] = useState<{ url: string; webcal: string; note: string } | null>(null);
  const make = useMutation({ mutationFn: () => api.post<{ url: string; webcal: string; note: string }>("/calendar/feed"), onSuccess: (r) => { setLink(r); qc.invalidateQueries({ queryKey: ["calfeed"] }); }, onError: toastErr });
  const revoke = useMutation({ mutationFn: () => api.del("/calendar/feed"), onSuccess: () => { setLink(null); toast.success("Link revoked"); qc.invalidateQueries({ queryKey: ["calfeed"] }); }, onError: toastErr });
  return (
    <Panel className="self-start">
      <PanelHeader title="Calendar subscription" sub="Hearings and deadlines in Google Calendar, Apple Calendar or Outlook." action={status.data?.enabled ? <Badge tone="leaf">Link active</Badge> : <Badge>Off</Badge>} />
      <div className="space-y-3 p-4">
        <p className="text-sm text-muted">Calendar apps cannot sign in, so they use a private link. It is shown once and stored only as a hash. Creating a new one replaces the old.</p>
        {link && (
          <div className="space-y-2 rounded-md border border-brass/30 bg-brass-soft p-3">
            <p className="break-all font-mono text-sm">{link.url}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => { navigator.clipboard.writeText(link.url); toast.success("Link copied"); }}><Copy className="h-3.5 w-3.5" /> Copy link</Button>
              <a href={link.webcal}><Button size="sm" variant="brass" type="button"><CalendarPlus className="h-3.5 w-3.5" /> Open in calendar app</Button></a>
            </div>
            <p className="text-xs text-amber">{link.note}</p>
          </div>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="primary" loading={make.isPending} onClick={() => make.mutate()}>{status.data?.enabled ? "Replace link" : "Create link"}</Button>
          {status.data?.enabled && <Button size="sm" variant="ghost" onClick={() => confirm("Revoke the link? Calendars using it stop updating.") && revoke.mutate()}>Revoke</Button>}
        </div>
      </div>
    </Panel>
  );
}
