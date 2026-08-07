import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { TrendingUp, Calendar, ChevronRight } from "lucide-react";
import type { WeeklyCheckIn } from "@shared/schema";

export default function CheckInHistory() {
  const { data: checkIns, isLoading } = useQuery<WeeklyCheckIn[]>({
    queryKey: ["/api/checkins"],
  });

  const sortedCheckIns = checkIns?.sort((a, b) => b.week - a.week) || [];

  const chartData = checkIns
    ?.sort((a, b) => a.week - b.week)
    .map((c) => ({
      week: `W${c.week}`,
      weight: c.weightLbs,
      waist: c.waistRelaxed,
      swRatio: c.shoulderToWaist,
      chest: c.chest,
      armsLeft: c.armsLeft,
      armsRight: c.armsRight,
      shoulders: c.shoulders,
      thighsLeft: c.thighsLeft,
      thighsRight: c.thighsRight,
      calvesLeft: c.calvesLeft,
      calvesRight: c.calvesRight,
    })) || [];

  const subjectiveData = checkIns
    ?.sort((a, b) => a.week - b.week)
    .map((c) => ({
      week: `W${c.week}`,
      sleep: c.sleepQuality,
      energy: c.energyLevels,
      motivation: c.trainingMotivation,
      hunger: c.hungerAppetite,
      mood: c.mood,
    })) || [];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-4 pb-24">
        <div className="max-w-4xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="max-w-4xl mx-auto p-4 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-accent flex items-center gap-2" data-testid="history-title">
            <TrendingUp className="w-6 h-6" />
            Check-In History
          </h1>
          <Link href="/checkin">
            <Badge className="bg-primary hover:bg-primary/90 cursor-pointer">
              New Check-In
            </Badge>
          </Link>
        </div>

        {sortedCheckIns.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No check-ins recorded yet</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Weight & Waist Chart */}
            <Card data-testid="card-weight-chart">
              <CardHeader>
                <CardTitle className="text-lg">Weight & Waist Trends</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis yAxisId="left" stroke="hsl(var(--accent))" fontSize={12} />
                      <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--chart-2))" fontSize={12} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Legend />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="weight"
                        name="Weight (lbs)"
                        stroke="hsl(var(--accent))"
                        strokeWidth={2}
                        dot={{ fill: "hsl(var(--accent))" }}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="waist"
                        name="Waist (in)"
                        stroke="hsl(var(--chart-2))"
                        strokeWidth={2}
                        dot={{ fill: "hsl(var(--chart-2))" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* S:W Ratio Chart */}
            <Card data-testid="card-ratio-chart">
              <CardHeader>
                <CardTitle className="text-lg">Shoulder-to-Waist Ratio</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--success))" fontSize={12} domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="swRatio"
                        name="S:W Ratio"
                        stroke="hsl(var(--success))"
                        strokeWidth={2}
                        dot={{ fill: "hsl(var(--success))" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Shoulders Chart */}
            <Card data-testid="card-shoulders-chart">
              <CardHeader>
                <CardTitle className="text-lg">Shoulders</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--chart-4))" fontSize={12} domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Line type="monotone" dataKey="shoulders" name="Shoulders (in)" stroke="hsl(var(--chart-4))" strokeWidth={2} dot={{ fill: "hsl(var(--chart-4))" }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Chest Chart */}
            <Card data-testid="card-chest-chart">
              <CardHeader>
                <CardTitle className="text-lg">Chest</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--chart-3))" fontSize={12} domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Line type="monotone" dataKey="chest" name="Chest (in)" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={{ fill: "hsl(var(--chart-3))" }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Arms Chart */}
            <Card data-testid="card-arms-chart">
              <CardHeader>
                <CardTitle className="text-lg">Arms</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="armsLeft" name="Left Arm (in)" stroke="#6366f1" strokeWidth={2} dot={{ fill: "#6366f1" }} />
                      <Line type="monotone" dataKey="armsRight" name="Right Arm (in)" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: "#8b5cf6" }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Thighs Chart */}
            <Card data-testid="card-thighs-chart">
              <CardHeader>
                <CardTitle className="text-lg">Thighs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="thighsLeft" name="Left Thigh (in)" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b" }} />
                      <Line type="monotone" dataKey="thighsRight" name="Right Thigh (in)" stroke="#f97316" strokeWidth={2} dot={{ fill: "#f97316" }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Calves Chart */}
            <Card data-testid="card-calves-chart">
              <CardHeader>
                <CardTitle className="text-lg">Calves</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="calvesLeft" name="Left Calf (in)" stroke="#22c55e" strokeWidth={2} dot={{ fill: "#22c55e" }} />
                      <Line type="monotone" dataKey="calvesRight" name="Right Calf (in)" stroke="#10b981" strokeWidth={2} dot={{ fill: "#10b981" }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Subjective Scores Chart */}
            <Card data-testid="card-subjective-chart">
              <CardHeader>
                <CardTitle className="text-lg">Subjective Scores</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={subjectiveData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis domain={[0, 10]} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="sleep" name="Sleep" stroke="#6366f1" strokeWidth={2} />
                      <Line type="monotone" dataKey="energy" name="Energy" stroke="#22c55e" strokeWidth={2} />
                      <Line type="monotone" dataKey="motivation" name="Motivation" stroke="#f59e0b" strokeWidth={2} />
                      <Line type="monotone" dataKey="hunger" name="Hunger" stroke="#ef4444" strokeWidth={2} />
                      <Line type="monotone" dataKey="mood" name="Mood" stroke="#8b5cf6" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Check-in List */}
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">All Check-Ins</h2>
              {sortedCheckIns.map((checkIn) => (
                <Card key={checkIn.id} className="hover-elevate cursor-pointer" data-testid={`card-checkin-${checkIn.week}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary rounded-md flex items-center justify-center">
                          <span className="text-lg font-bold text-white">{checkIn.week}</span>
                        </div>
                        <div>
                          <div className="font-semibold">Week {checkIn.week}</div>
                          <div className="text-sm text-muted-foreground">
                            {new Date(checkIn.date).toLocaleDateString()} • {checkIn.phase}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="font-semibold">{checkIn.weightLbs || "—"} lbs</div>
                          <div className="text-sm text-muted-foreground">
                            S:W {checkIn.shoulderToWaist?.toFixed(2) || "—"}
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
