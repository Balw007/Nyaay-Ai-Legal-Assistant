"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Matter } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorNote } from "@/components/ui/misc";
import { Drawer } from "./modal";

const EMPTY = { title: "", case_type: "ni138", court: "", case_number: "", cnr: "", client_name: "", goal: "Recover the cheque amount with compensation" };

export function NewMatter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [f, setF] = useState(EMPTY);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const create = useMutation({
    mutationFn: () => api.post<Matter>("/matters", Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]))),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ["matters"] }); qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Matter created");
      setF(EMPTY); onClose(); router.push(`/matters/${m.id}`);
    },
  });

  return (
    <Drawer open={open} onClose={onClose} title="New matter">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Field label="Title" hint="As the case is known, e.g. Complainant v. Accused">
          <Input required value={f.title} onChange={set("title")} placeholder="Complainant v. Accused" />
        </Field>
        <Field label="Case type" hint="Cheque dishonour is the first case type with a full playbook. More are coming.">
          <Select value={f.case_type} onChange={set("case_type")}>
            <option value="ni138">Cheque dishonour (NI Act s.138)</option>
          </Select>
        </Field>
        <Field label="Client"><Input value={f.client_name} onChange={set("client_name")} /></Field>
        <Field label="Court"><Input value={f.court} onChange={set("court")} placeholder="JMFC Court No. 4, Pune" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Case number"><Input value={f.case_number} onChange={set("case_number")} placeholder="SCC/1182/2026" /></Field>
          <Field label="CNR" hint="16 characters, for eCourts sync"><Input value={f.cnr} onChange={set("cnr")} maxLength={16} placeholder="MHPU010012342026" className="uppercase" /></Field>
        </div>
        <Field label="Goal" hint="What the client wants out of this case. Nyaay plans the route toward it.">
          <Select value={f.goal} onChange={set("goal")}>
            <option>Recover the cheque amount with compensation</option>
            <option>Settle (compound) the case</option>
            <option>Defend: acquittal of the accused</option>
            <option>Defend: settle on terms</option>
          </Select>
        </Field>
        <ErrorNote error={create.error} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={create.isPending}>Create matter</Button>
        </div>
      </form>
    </Drawer>
  );
}
