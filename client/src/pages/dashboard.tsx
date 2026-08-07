import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentWeek, getDaysUntilShow, getCurrentPhase, getPhaseColor, getDayName, getDayFocus, isDeloadWeek } from "@/lib/utils";
import { Calendar, Dumbbell, CheckCircle2, Circle, TrendingUp, AlertTriangle, Scale, Check, X, Activity, Wind, Plus, Flame } from "lucide-react";
import type { WorkoutLog, WeeklyCheckIn, Recommendation, CardioSession, VacuumSession, User } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePrep } from "@/hooks/use-prep";

export default function Dashboard() {
  const { toast } = useToast();
  const { currentWeek, daysUntilShow } = usePrep();
  const phase = getCurrentPhase(currentWeek);
  const isDeload = isDeloadWeek(currentWeek);

  const { data: user } = useQuery<User | null>({ queryKey: ["/api/user"] });
  const activeProgram = user?.activeProgram || 'phase2';

  const { data: workoutLogs, isLoading: workoutsLoading } = useQuery<WorkoutLog[]>({
    queryKey: ["/api/workouts", currentWeek],
  });

  const updateRecommendationMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return apiRequest("PATCH", `/api/recommendations/${id}`, { status });
    },
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
      toast({
        title: status === "accepted" ? "Recommendation accepted" : "Recommendation dismissed",
        description: status === "accepted" 
          ? "Weight will be increased next session" 
          : "No changes will be made",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update recommendation",
        variant: "destructive",
      });
    },
  });

  const { data: latestCheckIn, isLoading: checkInLoading } = useQuery<WeeklyCheckIn>({
    queryKey: ["/api/checkins/latest"],
  });

  const { data: recommendations, isLoading: recsLoading } = useQuery<Recommendation[]>({
    queryKey: ["/api/recommendations", "pending"],
  });

  const { data: cardioSessions = [] } = useQuery<CardioSession[]>({
    queryKey: ["/api/cardio"],
  });

  const { data: vacuumStats } = useQuery<{
    todayCompleted: boolean;
    streak: number;
    daysPracticed: number;
  }>({
    queryKey: ["/api/stats/vacuum"],
  });

  const weekCardioSessions = cardioSessions.filter(s => s.week === currentWeek);
  const weekCardioCount = weekCardioSessions.length;

  const getWorkoutStatus = (day: number) => {
    if (!workoutLogs) return null;
    return workoutLogs.find((w) => w.day === day && w.week === currentWeek);
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-4xl mx-auto p-4 space-y-6">
        {/* Header Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card data-testid="card-week">
            <CardContent className="p-4 text-center">
              <div className="text-3xl font-bold text-accent">{currentWeek}</div>
              <div className="text-sm text-muted-foreground">Week</div>
            </CardContent>
          </Card>
          
          <Card data-testid="card-phase">
            <CardContent className="p-4 text-center">
              <Badge className={`${getPhaseColor(phase)} text-white text-sm`} data-testid="badge-phase">
                {phase}
              </Badge>
              <div className="text-sm text-muted-foreground mt-1">Phase</div>
            </CardContent>
          </Card>
          
          <Card data-testid="card-countdown">
            <CardContent className="p-4 text-center">
              <div className="text-3xl font-bold text-foreground">{daysUntilShow}</div>
              <div className="text-sm text-muted-foreground">Days to Show</div>
            </CardContent>
          </Card>
          
          <Card data-testid="card-weight">
            <CardContent className="p-4 text-center">
              {checkInLoading ? (
                <Skeleton className="h-8 w-16 mx-auto" />
              ) : (
                <div className="text-3xl font-bold text-foreground">
                  {latestCheckIn?.weightLbs || "—"}
                </div>
              )}
              <div className="text-sm text-muted-foreground">lbs</div>
            </CardContent>
          </Card>
        </div>

        {/* Deload Banner */}
        {isDeload && (
          <Card className="border-warning bg-warning/10" data-testid="banner-deload">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-warning" />
              <div>
                <div className="font-semibold text-warning">DELOAD WEEK</div>
                <div className="text-sm text-muted-foreground">
                  Reduce volume by 40%. Drop 1-2 sets per exercise. Maintain current weights.
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* This Week's Workouts */}
        <div>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Dumbbell className="w-5 h-5 text-accent" />
            This Week's Workouts
          </h2>
          
          <div className="grid gap-3">
            {[1, 2, 3, 4, 5, 6].map((day) => {
              const workout = getWorkoutStatus(day);
              const isCompleted = workout?.completed;
              
              return (
                <Link key={day} href={`/workout/${day}`}>
                  <Card 
                    className="hover-elevate cursor-pointer transition-all" 
                    data-testid={`card-workout-day-${day}`}
                  >
                    <CardContent className="p-4 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-md flex items-center justify-center ${
                          isCompleted ? "bg-green-600" : "bg-primary"
                        }`}>
                          {isCompleted ? (
                            <CheckCircle2 className="w-5 h-5 text-white" />
                          ) : (
                            <span className="text-lg font-bold text-white">{day}</span>
                          )}
                        </div>
                        <div>
                          <div className="font-semibold">
                            Day {day} — {getDayName(day)}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {getDayFocus(day, activeProgram)}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        {isCompleted ? (
                          <Badge variant="secondary" className="bg-green-600/20 text-green-400">
                            Completed
                          </Badge>
                        ) : workout ? (
                          <Badge variant="secondary" className="bg-yellow-600/20 text-yellow-400">
                            In Progress
                          </Badge>
                        ) : (
                          <Circle className="w-5 h-5 text-muted-foreground" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Cardio & Vacuum Widgets */}
        <div className="grid grid-cols-2 gap-3">
          <Link href="/cardio">
            <Card className="hover-elevate cursor-pointer" data-testid="card-cardio-widget">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-accent" />
                  <span className="font-semibold text-sm">CARDIO</span>
                  <span className="text-xs text-muted-foreground ml-auto">This Week</span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className={`w-3 h-3 rounded-full ${
                        i < weekCardioCount ? "bg-green-500" : "bg-muted"
                      }`}
                    />
                  ))}
                  <span className="text-sm font-medium ml-1">{weekCardioCount}/3</span>
                </div>
                <Button variant="ghost" size="sm" className="w-full mt-2 text-xs">
                  <Plus className="w-3 h-3 mr-1" />
                  Add Session
                </Button>
              </CardContent>
            </Card>
          </Link>

          <Link href="/vacuum">
            <Card className="hover-elevate cursor-pointer" data-testid="card-vacuum-widget">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Wind className="w-4 h-4 text-accent" />
                  <span className="font-semibold text-sm">VACUUM</span>
                  <span className="text-xs text-muted-foreground ml-auto">Today</span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  {vacuumStats?.todayCompleted ? (
                    <div className="flex items-center gap-1 text-green-500">
                      <CheckCircle2 className="w-4 h-4" />
                      <span className="text-sm font-medium">Done</span>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Not logged</span>
                  )}
                </div>
                {(vacuumStats?.streak ?? 0) > 0 && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Flame className="w-3 h-3 text-orange-500" />
                    Streak: {vacuumStats?.streak} days
                  </div>
                )}
                <Button variant="ghost" size="sm" className="w-full mt-2 text-xs">
                  <Plus className="w-3 h-3 mr-1" />
                  Add Vacuum
                </Button>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Pending Recommendations */}
        {recommendations && recommendations.length > 0 && (
          <div>
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-warning" />
              Recommendations
            </h2>
            
            <div className="grid gap-3">
              {recommendations.map((rec) => (
                <Card 
                  key={rec.id} 
                  className="border-warning/50 bg-warning/5"
                  data-testid={`card-recommendation-${rec.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="font-medium text-warning">{rec.message}</div>
                        <Badge variant="secondary" className="mt-2 text-xs">
                          {rec.type.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="text-green-400 hover:bg-green-600/20"
                          onClick={() => updateRecommendationMutation.mutate({ id: rec.id, status: "accepted" })}
                          disabled={updateRecommendationMutation.isPending}
                          data-testid={`button-accept-${rec.id}`}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="text-red-400 hover:bg-red-600/20"
                          onClick={() => updateRecommendationMutation.mutate({ id: rec.id, status: "dismissed" })}
                          disabled={updateRecommendationMutation.isPending}
                          data-testid={`button-dismiss-${rec.id}`}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Latest Check-in Summary */}
        <div>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Scale className="w-5 h-5 text-link" />
            Latest Check-In
          </h2>
          
          <Card data-testid="card-latest-checkin">
            <CardContent className="p-4">
              {checkInLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : latestCheckIn ? (
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold">{latestCheckIn.weightLbs || "—"}</div>
                    <div className="text-sm text-muted-foreground">Weight (lbs)</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{latestCheckIn.waistRelaxed || "—"}</div>
                    <div className="text-sm text-muted-foreground">Waist (in)</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{latestCheckIn.shoulderToWaist?.toFixed(2) || "—"}</div>
                    <div className="text-sm text-muted-foreground">S:W Ratio</div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <div className="text-muted-foreground mb-3">No check-in recorded yet</div>
                  <Link href="/checkin">
                    <Button data-testid="button-first-checkin">Record First Check-In</Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
