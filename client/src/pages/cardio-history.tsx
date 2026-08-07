import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Activity, Loader2 } from "lucide-react";
import { Link } from "wouter";
import type { CardioSession } from "@shared/schema";
import { format } from "date-fns";

export default function CardioHistoryPage() {
  const [weekFilter, setWeekFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data: sessions = [], isLoading } = useQuery<CardioSession[]>({
    queryKey: ["/api/cardio"],
  });

  const filteredSessions = sessions.filter(s => {
    if (weekFilter !== "all" && s.week !== parseInt(weekFilter)) return false;
    if (typeFilter !== "all" && s.type !== typeFilter) return false;
    return true;
  });

  const totalSessions = filteredSessions.length;
  const totalMinutes = filteredSessions.reduce((sum, s) => sum + s.durationMin, 0);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  const weeksAtGoal = new Set(
    sessions.filter((_, __, arr) => {
      const weekGroups: Record<number, number> = {};
      arr.forEach(s => {
        weekGroups[s.week] = (weekGroups[s.week] || 0) + 1;
      });
      return Object.entries(weekGroups).filter(([, count]) => count >= 3).length;
    }).map(s => s.week)
  ).size;

  const typeCounts = filteredSessions.reduce((acc, s) => {
    acc[s.type] = (acc[s.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const mostCommonType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

  const weeks = Array.from({ length: 36 }, (_, i) => i + 1);

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl pb-24">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/cardio">
          <Button variant="ghost" size="icon" data-testid="button-back-cardio">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <Activity className="h-6 w-6" />
            Cardio History
          </h1>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        <Select value={weekFilter} onValueChange={setWeekFilter}>
          <SelectTrigger className="flex-1" data-testid="select-week-filter">
            <SelectValue placeholder="Week" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Weeks</SelectItem>
            {weeks.map(w => (
              <SelectItem key={w} value={String(w)}>Week {w}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="flex-1" data-testid="select-type-filter">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="HIIT">HIIT</SelectItem>
            <SelectItem value="LISS">LISS</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Summary Stats</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Total Sessions:</span>
              <span className="ml-2 font-medium">{totalSessions}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Total Duration:</span>
              <span className="ml-2 font-medium">{hours}h {mins}m</span>
            </div>
            <div>
              <span className="text-muted-foreground">Weeks at 3+:</span>
              <span className="ml-2 font-medium">{weeksAtGoal}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Most Common:</span>
              <span className="ml-2 font-medium">{mostCommonType}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredSessions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No cardio sessions found
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredSessions.map((session) => (
            <Card key={session.id}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="text-xs text-muted-foreground w-10">
                      W{session.week}
                    </div>
                    <div className={`px-2 py-1 rounded text-xs font-medium ${
                      session.type === "HIIT" 
                        ? "bg-orange-500/20 text-orange-400" 
                        : "bg-blue-500/20 text-blue-400"
                    }`}>
                      {session.type}
                    </div>
                    <div>
                      <div className="font-medium text-sm">
                        {session.subtype || session.type}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(session.date), "MMM d, yyyy")}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{session.durationMin} min</div>
                    {session.notes && (
                      <div className="text-xs text-muted-foreground max-w-32 truncate">
                        {session.notes}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
