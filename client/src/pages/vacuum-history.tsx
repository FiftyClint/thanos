import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Wind, Loader2 } from "lucide-react";
import { Link } from "wouter";
import type { VacuumSession } from "@shared/schema";
import { format } from "date-fns";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

function formatSeconds(totalSecs: number): string {
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function VacuumHistoryPage() {
  const [weekFilter, setWeekFilter] = useState<string>("all");
  const [timeFilter, setTimeFilter] = useState<string>("all");

  const { data: sessions = [], isLoading } = useQuery<VacuumSession[]>({
    queryKey: ["/api/vacuum"],
  });

  const filteredSessions = sessions.filter(s => {
    if (weekFilter !== "all" && s.week !== parseInt(weekFilter)) return false;
    if (timeFilter !== "all" && s.timeOfDay !== timeFilter) return false;
    return true;
  });

  const uniqueDays = new Set(filteredSessions.map(s => {
    const d = new Date(s.date);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }));

  const allDurations = filteredSessions.map(s => s.durationSec);
  const avgDuration = allDurations.length > 0 
    ? Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length)
    : 0;
  const bestHold = allDurations.length > 0 ? Math.max(...allDurations) : 0;

  const weeklyData = Array.from({ length: 36 }, (_, i) => {
    const week = i + 1;
    const weekSessions = sessions.filter(s => s.week === week);
    const avgHold = weekSessions.length > 0
      ? Math.round(weekSessions.reduce((sum, s) => sum + s.durationSec, 0) / weekSessions.length)
      : 0;
    return { week: `W${week}`, avgHold };
  }).filter(d => d.avgHold > 0);

  const weeks = Array.from({ length: 36 }, (_, i) => i + 1);

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl pb-24">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/vacuum">
          <Button variant="ghost" size="icon" data-testid="button-back-vacuum">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <Wind className="h-6 w-6" />
            Vacuum History
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
        
        <Select value={timeFilter} onValueChange={setTimeFilter}>
          <SelectTrigger className="flex-1" data-testid="select-time-filter">
            <SelectValue placeholder="Time" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Times</SelectItem>
            <SelectItem value="Morning">Morning</SelectItem>
            <SelectItem value="Afternoon">Afternoon</SelectItem>
            <SelectItem value="Evening">Evening</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {weeklyData.length > 1 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Hold Duration Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} stroke="#666" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#666" unit="s" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid #333" }}
                    labelStyle={{ color: "#fff" }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="avgHold" 
                    stroke="#8B0000" 
                    strokeWidth={2}
                    dot={{ fill: "#8B0000", r: 3 }}
                    name="Avg Hold (s)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Summary Stats</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Days Practiced:</span>
              <span className="ml-2 font-medium">{uniqueDays.size}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Total Sessions:</span>
              <span className="ml-2 font-medium">{filteredSessions.length}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Avg Hold Duration:</span>
              <span className="ml-2 font-medium">{avgDuration}s</span>
            </div>
            <div>
              <span className="text-muted-foreground">Best Single Hold:</span>
              <span className="ml-2 font-medium">{bestHold}s</span>
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
            No vacuum sessions found
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
                    <div className="px-2 py-1 rounded text-xs font-medium bg-primary/20 text-primary">
                      {session.timeOfDay}
                    </div>
                    <div>
                      <div className="font-medium text-sm">
                        {session.sets} sets × {session.durationSec}s
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(session.date), "MMM d, yyyy")}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{formatSeconds(session.sets * session.durationSec)}</div>
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
