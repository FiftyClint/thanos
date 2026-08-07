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
import { Plus, Trash2, Wind, Loader2, Flame, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import type { VacuumSession } from "@shared/schema";
import { format, subDays, isSameDay } from "date-fns";

function formatSeconds(totalSecs: number): string {
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function VacuumPage() {
  const { toast } = useToast();
  const { currentWeek } = usePrep();
  const phase = getCurrentPhase(currentWeek);
  const today = new Date();
  
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split("T")[0],
    timeOfDay: "Morning" as "Morning" | "Afternoon" | "Evening",
    sets: "",
    durationSec: "",
    notes: "",
  });

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<VacuumSession[]>({
    queryKey: ["/api/vacuum"],
  });

  const { data: stats } = useQuery<{
    todayCompleted: boolean;
    todaySessions: number;
    todayTotalSets: number;
    todayTotalSeconds: number;
    todayLongestHold: number;
    streak: number;
    daysPracticed: number;
    weekTotalSets: number;
    avgHoldDuration: number;
    bestHold: number;
  }>({
    queryKey: ["/api/stats/vacuum"],
  });

  const todaySessions = sessions.filter(s => 
    isSameDay(new Date(s.date), today)
  );

  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const date = subDays(today, 6 - i);
    const hasSession = sessions.some(s => isSameDay(new Date(s.date), date));
    return { date, hasSession };
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/vacuum", {
        date: formData.date,
        week: currentWeek,
        timeOfDay: formData.timeOfDay,
        sets: parseInt(formData.sets),
        durationSec: parseInt(formData.durationSec),
        notes: formData.notes,
      });
      return { queued: wasQueued(res) };
    },
    onSuccess: ({ queued }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/vacuum"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/vacuum"] });
      setShowAddForm(false);
      setFormData({
        date: new Date().toISOString().split("T")[0],
        timeOfDay: "Morning",
        sets: "",
        durationSec: "",
        notes: "",
      });
      toast({
        title: "Vacuum session logged!",
        description: queued ? "Saved on this device — it'll upload when you're back online." : undefined,
      });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/vacuum/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vacuum"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/vacuum"] });
      toast({ title: "Session deleted" });
    },
  });

  const todayTotalSets = todaySessions.reduce((sum, s) => sum + s.sets, 0);
  const todayTotalSeconds = todaySessions.reduce((sum, s) => sum + (s.sets * s.durationSec), 0);
  const todayLongestHold = todaySessions.length > 0 
    ? Math.max(...todaySessions.map(s => s.durationSec))
    : 0;

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl pb-24">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <Wind className="h-6 w-6" />
            STOMACH VACUUM
          </h1>
          <p className="text-muted-foreground text-sm">Week {currentWeek} • {phase}</p>
        </div>
        <Link href="/vacuum/history">
          <Button variant="outline" size="sm" data-testid="link-vacuum-history">History</Button>
        </Link>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Goal: Daily practice</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              {todaySessions.length > 0 ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <span className="text-green-500 font-medium">Complete</span>
                </>
              ) : (
                <span className="text-muted-foreground">Not logged today</span>
              )}
            </div>
          </div>

          <div className="flex gap-2 mb-4">
            {last7Days.map(({ date, hasSession }, i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full ${
                  hasSession ? "bg-green-500" : "bg-card border border-border"
                }`}
                title={format(date, "EEE")}
                data-testid={`streak-day-${i}`}
              />
            ))}
          </div>
          
          {(stats?.streak ?? 0) > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Flame className="h-4 w-4 text-orange-500" />
              <span>Streak: {stats?.streak} days</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAddForm} onOpenChange={setShowAddForm}>
        <DialogTrigger asChild>
          <Button className="w-full mb-6" size="lg" data-testid="button-add-vacuum">
            <Plus className="h-5 w-5 mr-2" />
            Add Stomach Vacuum
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Vacuum Session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                data-testid="input-vacuum-date"
              />
            </div>
            
            <div>
              <Label htmlFor="timeOfDay">Time of Day</Label>
              <Select
                value={formData.timeOfDay}
                onValueChange={(v) => setFormData({ ...formData, timeOfDay: v as any })}
              >
                <SelectTrigger data-testid="select-vacuum-time">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Morning">Morning</SelectItem>
                  <SelectItem value="Afternoon">Afternoon</SelectItem>
                  <SelectItem value="Evening">Evening</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="sets">Sets</Label>
              <Input
                id="sets"
                type="number"
                inputMode="numeric"
                placeholder="5"
                value={formData.sets}
                onChange={(e) => setFormData({ ...formData, sets: e.target.value })}
                data-testid="input-vacuum-sets"
              />
            </div>

            <div>
              <Label htmlFor="duration">Duration per hold (seconds)</Label>
              <Input
                id="duration"
                type="number"
                inputMode="numeric"
                placeholder="30"
                value={formData.durationSec}
                onChange={(e) => setFormData({ ...formData, durationSec: e.target.value })}
                data-testid="input-vacuum-duration"
              />
            </div>

            <div>
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Felt stronger today..."
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                data-testid="input-vacuum-notes"
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowAddForm(false)}
                data-testid="button-cancel-vacuum"
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={() => addMutation.mutate()}
                disabled={!formData.sets || !formData.durationSec || addMutation.isPending}
                data-testid="button-save-vacuum"
              >
                {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {todaySessions.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-3">Today's Log</h2>
          <div className="space-y-2">
            {todaySessions.map((session) => (
              <Card key={session.id} className="hover-elevate">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="px-2 py-1 rounded text-xs font-medium bg-primary/20 text-primary">
                        {session.timeOfDay}
                      </div>
                      <div>
                        <div className="font-medium">
                          {session.sets} sets × {session.durationSec}s
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Total: {formatSeconds(session.sets * session.durationSec)}
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
                      data-testid={`button-delete-vacuum-${session.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {todaySessions.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">TODAY ({format(today, "MMM d")})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Sessions:</span>
                <span className="ml-2 font-medium">{todaySessions.length}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Total Sets:</span>
                <span className="ml-2 font-medium">{todayTotalSets}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Total Hold Time:</span>
                <span className="ml-2 font-medium">{formatSeconds(todayTotalSeconds)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Longest Hold:</span>
                <span className="ml-2 font-medium">{todayLongestHold}s</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">THIS WEEK (Week {currentWeek})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Days Practiced:</span>
              <span className="ml-2 font-medium">{stats?.daysPracticed || 0}/7</span>
            </div>
            <div>
              <span className="text-muted-foreground">Total Sets:</span>
              <span className="ml-2 font-medium">{stats?.weekTotalSets || 0}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Avg Hold Duration:</span>
              <span className="ml-2 font-medium">{stats?.avgHoldDuration || 0}s</span>
            </div>
            <div>
              <span className="text-muted-foreground">Best Hold:</span>
              <span className="ml-2 font-medium">{stats?.bestHold || 0}s</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
