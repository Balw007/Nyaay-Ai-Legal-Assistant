"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { AiStatus, Me, Task } from "./types";

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/auth/me"), staleTime: 5 * 60_000 });

export const useHealth = () => useQuery({
  queryKey: ["health"], refetchInterval: 60_000,
  queryFn: () => api.get<{ ai: AiStatus; judgments_indexed: number; real_judgments: number; index_is_fixture: boolean }>("/health"),
});

export const usePendingApprovals = () => useQuery({
  queryKey: ["tasks", "proposed"], refetchInterval: 60_000,
  queryFn: () => api.get<Task[]>("/tasks?status=proposed"),
});

export const canApprove = (role?: string) => role === "owner" || role === "admin" || role === "advocate";
export const isAdmin = (role?: string) => role === "owner" || role === "admin";
