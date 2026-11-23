// One navigation model for the rail, the mobile dock, the command palette and keyboard shortcuts.
import { ArrowLeftRight, BadgeCheck, BookOpen, Bot, CalendarDays, CheckCheck, FileSignature, FolderOpen, Home, Library, Network, Search, Settings, ShieldCheck, Users } from "lucide-react";

export type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; key?: string; hint?: string };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  { label: "Workspace", items: [
    { href: "/", label: "Home", icon: Home, key: "h", hint: "Your day: hearings, deadlines, agents and approvals" },
    { href: "/research", label: "Research", icon: Search, key: "r" },
    { href: "/acts", label: "Acts & Rules", icon: BookOpen, key: "t", hint: "Bare Acts, linked to the judgments that discuss them" },
    { href: "/matters", label: "Matters", icon: FolderOpen, key: "m" },
    { href: "/approvals", label: "Approvals", icon: CheckCheck, key: "a", hint: "Proposals waiting for an advocate" },
    { href: "/calendar", label: "Calendar", icon: CalendarDays, key: "c" },
  ] },
  { label: "Practice", items: [
    { href: "/drafts", label: "Drafts", icon: FileSignature, key: "d" },
    { href: "/citations", label: "Citation check", icon: ShieldCheck, key: "v" },
    { href: "/clients", label: "Clients", icon: Users, key: "u" },
  ] },
  { label: "Intelligence", items: [
    { href: "/intelligence", label: "AI Agents", icon: Bot, key: "i", hint: "Agents at work, their steps and results, and system health" },
    { href: "/graph", label: "Knowledge Graph", icon: Network, key: "g", hint: "How judgments, courts and your matters connect" },
    { href: "/library", label: "Library", icon: Library, key: "l" },
    { href: "/gold", label: "Gold set", icon: BadgeCheck, key: "o", hint: "Headnotes written and verified by an advocate" },
    { href: "/tools/convert", label: "IPC to BNS", icon: ArrowLeftRight, key: "b" },
  ] },
  { label: "System", items: [
    { href: "/settings", label: "Settings", icon: Settings, key: "s" },
  ] },
];

export const ALL_NAV = NAV.flatMap((g) => g.items);

export const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

/** The workspace the user is in, for the command bar and the AI context. */
export function workspaceOf(path: string): NavItem {
  if (path.startsWith("/judgments/")) return { href: "/research", label: "Judgment", icon: Search };
  return [...ALL_NAV].sort((a, b) => b.href.length - a.href.length).find((n) => isActive(path, n.href)) ?? ALL_NAV[0];
}
