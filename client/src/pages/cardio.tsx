import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, wasQueued } from "@/lib/queryClient";
import { getCurrentWeek, getCurrentPhase } from "@/lib/utils";
import { usePrep } from "@/hooks/use-prep";
import { Plus, Trash2, Activity, Loader2, Flame } from "lucide-react";
import { Link } from "wouter";
import type { CardioSession } from "@shared/schema";
import { format } from "date-fns";

export default function CardioPage() {
  const { toast } = useToast();
  const { currentWeek } = usePrep();
  const phase = getCurrentPhase(currentWeek);
  
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split("T")[0],
    type: "LISS" as "HIIT" | "LISS",
    subtype: "Walking" as "Walking" | "Incline Treadmill" | "Ruck",
    durationMin: "",
    notes: "",
  });

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<CardioSession[]>({
    queryKey: ["/api/cardio"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<{
    totalSessions: number;
    totalDuration: number;
    hiitCount: number;
    lissCount: number;
    weeklyGoal: number;
    currentWeekSessions: number;
    isGoalMet: boolean;
    streak: number;
  }>({
    queryKey: ["/api/stats/cardio", currentWeek],
    queryFn: () => fetch(`/api/stats/cardio?week=${currentWeek}`).then(r => r.json()),
  });

  const weekSessions = sessions.filter(s => s.week === currentWeek);
  const recentSessions = sessions.slice(0, 5);

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/cardio", {
        date: formData.date,
        week: currentWeek,
        type: formData.type,
        subtype: formData.type === "LISS" ? formData.subtype : null,
        durationMin: parseInt(formData.durationMin),
        notes: formData.notes,
      });
      return { queued: wasQueued(res) };
    },
    onSuccess: ({ queued }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cardio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/cardio"] });
      setShowAddForm(false);
      setFormData({
        date: new Date().toISOString().split("T")[0],
        type: "LISS",
        subtype: "Walking",
        durationMin: "",
        notes: "",
      });
      toast({
        title: "Cardio session logged!",
        description: queued ? "Saved on this device — it'll upload when you're back online." : undefined,
      });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/cardio/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cardio"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/cardio"] });
      toast({ title: "Session deleted" });
    },
  });

  const weeklyCompleted = stats?.currentWeekSessions || weekSessions.length;
  const weeklyGoal = 3;

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl pb-24">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <Activity className="h-6 w-6" />
            CARDIO
          </h1>
          <p className="text-muted-foreground text-sm">Week {currentWeek} • {phase}</p>
        </div>
        <Link href="/cardio/history">
          <Button variant="outline" size="sm" data-testid="link-cardio-history">History</Button>
        </Link>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Weekly Goal: 3× per week</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-4">
            <div className="flex gap-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full ${
                    i < weeklyCompleted ? "bg-green-500" : "bg-card border border-border"
                  }`}
                  data-testid={`progress-circle-${i}`}
                />
              ))}
            </div>
            <span className="text-lg font-semibold">{weeklyCompleted}/3</span>
            {weeklyCompleted >= 3 && (
              <span className="text-green-500 text-sm font-medium">Goal Met!</span>
            )}
          </div>
          
          {(stats?.streak ?? 0) > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Flame className="h-4 w-4 text-orange-500" />
              <span>Current Streak: {stats?.streak} weeks at 3+</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAddForm} onOpenChange={setShowAddForm}>
        <DialogTrigger asChild>
          <Button className="w-full mb-6" size="lg" data-testid="button-add-cardio">
            <Plus className="h-5 w-5 mr-2" />
            Add Cardio Session
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Cardio Session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                data-testid="input-cardio-date"
              />
            </div>
            
            <div>
              <Label htmlFor="type">Type</Label>
              <Select
                value={formData.type}
                onValueChange={(v) => setFormData({ ...formData, type: v as "HIIT" | "LISS" })}
              >
                <SelectTrigger data-testid="select-cardio-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HIIT">HIIT</SelectItem>
                  <SelectItem value="LISS">LISS</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formData.type === "LISS" && (
              <div>
                <Label htmlFor="subtype">Subtype</Label>
                <Select
                  value={formData.subtype}
                  onValueChange={(v) => setFormData({ ...formData, subtype: v as any })}
                >
                  <SelectTrigger data-testid="select-cardio-subtype">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Walking">Walking</SelectItem>
                    <SelectItem value="Incline Treadmill">Incline Treadmill</SelectItem>
                    <SelectItem value="Ruck">Ruck</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label htmlFor="duration">Duration (min)</Label>
              <Input
                id="duration"
                type="number"
                inputMode="numeric"
                placeholder="30"
                value={formData.durationMin}
                onChange={(e) => setFormData({ ...formData, durationMin: e.target.value })}
                data-testid="input-cardio-duration"
              />
            </div>

            <div>
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Zone 2 focus, felt good..."
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                data-testid="input-cardio-notes"
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowAddForm(false)}
                data-testid="button-cancel-cardio"
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={() => addMutation.mutate()}
                disabled={!formData.durationMin || addMutation.isPending}
                data-testid="button-save-cardio"
              >
                {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Recent Sessions</h2>
        {sessionsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : recentSessions.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No cardio sessions logged yet
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {recentSessions.map((session) => (
              <Card key={session.id} className="hover-elevate">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`px-2 py-1 rounded text-xs font-medium ${
                        session.type === "HIIT" 
                          ? "bg-orange-500/20 text-orange-400" 
                          : "bg-blue-500/20 text-blue-400"
                      }`}>
                        {session.type}
                      </div>
                      <div>
                        <div className="font-medium">
                          {session.subtype || session.type}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {format(new Date(session.date), "MMM d")} • {session.durationMin} min
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm("Delete this session?")) {
                          deleteMutation.mutate(session.id);
                        }
                      }}
                      data-testid={`button-delete-cardio-${session.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">THIS WEEK (Week {currentWeek})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Sessions:</span>
              <span className="ml-2 font-medium">{weeklyCompleted}/3</span>
            </div>
            <div>
              <span className="text-muted-foreground">Total Duration:</span>
              <span className="ml-2 font-medium">
                {weekSessions.reduce((sum, s) => sum + s.durationMin, 0)} min
              </span>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">Types:</span>
              <span className="ml-2 font-medium">
                {weekSessions.filter(s => s.type === "HIIT").length > 0 && 
                  `HIIT ×${weekSessions.filter(s => s.type === "HIIT").length}`}
                {weekSessions.filter(s => s.type === "HIIT").length > 0 && 
                  weekSessions.filter(s => s.type === "LISS").length > 0 && ", "}
                {weekSessions.filter(s => s.type === "LISS").length > 0 && 
                  `LISS ×${weekSessions.filter(s => s.type === "LISS").length}`}
                {weekSessions.length === 0 && "—"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
