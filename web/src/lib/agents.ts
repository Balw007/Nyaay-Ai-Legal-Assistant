"use client";
// Real background agents (backend: app/services/agents.py). Every status, step and progress value shown in the UI
// comes from these endpoints; the UI never animates progress it has not been told about.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { AskSource } from "./types";

export type AgentId = "research" | "judgment" | "citation" | "drafting";
export interface AgentInfo { id: AgentId; name: string; does: string; engine: string[]; without_ai: string; ai_ready: boolean; available: boolean; mode: "full" | "reduced" | "unavailable" }
export interface AgentStep { at: string; text: string }
export interface AgentTask {
  id: number; agent: AgentId; agent_name: string; title: string; input: Record<string, unknown>; matter_id: number | null;
  status: "queued" | "running" | "done" | "failed" | "cancelled"; progress: number; indeterminate: boolean; step: string;
  steps: AgentStep[]; result: Record<string, unknown> | null; error: string; cancel_requested: boolean; user_name: string;
  created_at: string; started_at: string | null; finished_at: string | null; needs_review: boolean;
}
export interface ResearchResult { question: string; mode: string; answer: string | null; sources: AskSource[]; message?: string; confidence?: string; limitations?: string; checks?: { invalid_markers_removed: number[]; uncited_sentences: string[]; cited_sources: number[] } }

/** Backend timestamps are UTC without a zone marker. */
export const utc = (s?: string | null) => (s ? (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`) : null);

export const isActive = (t: AgentTask) => t.status === "queued" || t.status === "running";

export const useAgents = () => useQuery({ queryKey: ["agents"], queryFn: () => api.get<AgentInfo[]>("/agents"), staleTime: 30_000 });

export function useTasks(limit = 20) {
  return useQuery({
    queryKey: ["agent-tasks", limit],
    queryFn: () => api.get<AgentTask[]>(`/agents/tasks?limit=${limit}`),
    refetchInterval: (q) => (q.state.data?.some(isActive) ? 1200 : 15_000),
  });
}

export function useTask(id: number | null) {
  return useQuery({
    queryKey: ["agent-task", id], enabled: id !== null,
    queryFn: () => api.get<AgentTask>(`/agents/tasks/${id}`),
    refetchInterval: (q) => (q.state.data && isActive(q.state.data) ? 900 : false),
  });
}

export function useStartAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { agent: AgentId; input: Record<string, unknown> }) => api.post<AgentTask>("/agents/tasks", b),
    onSuccess: (t) => { qc.setQueryData(["agent-task", t.id], t); qc.invalidateQueries({ queryKey: ["agent-tasks"] }); },
  });
}

export function useCancelAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<AgentTask>(`/agents/tasks/${id}/cancel`),
    onSuccess: (t) => { qc.setQueryData(["agent-task", t.id], t); qc.invalidateQueries({ queryKey: ["agent-tasks"] }); },
  });
}

export const AGENT_TONE: Record<AgentId, string> = { research: "cyan", judgment: "electric", citation: "leaf", drafting: "brass" };
