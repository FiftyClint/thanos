import { useMutation, useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { User } from "@shared/schema";

const PROGRAMS = [
  { value: "phase3", label: "Phase 3 — Cut" },
  { value: "phase2", label: "Phase 2 — Build" },
  { value: "phase1", label: "Phase 1 — Enhance" },
];

export default function ProgramSelector() {
  const { toast } = useToast();
  const { data: user } = useQuery<User | null>({ queryKey: ["/api/user"] });

  const mutation = useMutation({
    mutationFn: async (program: string) => {
      await apiRequest("PUT", "/api/user/program", { program });
    },
    onSuccess: (_data, program) => {
      queryClient.setQueryData<User | null>(["/api/user"], (old) =>
        old ? { ...old, activeProgram: program } : old
      );
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sets/recommendations"] });
      toast({
        title: "Program switched",
        description: PROGRAMS.find(p => p.value === program)?.label,
      });
    },
  });

  if (!user) return null;

  return (
    <Select
      value={user.activeProgram || "phase3"}
      onValueChange={(val) => mutation.mutate(val)}
      disabled={mutation.isPending}
    >
      <SelectTrigger
        className="h-7 text-xs bg-muted border-border w-auto gap-1 pr-2"
        data-testid="select-program"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {PROGRAMS.map((p) => (
          <SelectItem key={p.value} value={p.value} className="text-xs" data-testid={`option-program-${p.value}`}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
