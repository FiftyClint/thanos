import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Calendar, Dumbbell, Clock } from "lucide-react";
import type { WorkoutLog, SetLog, Exercise, User } from "@shared/schema";
import { getDayName, getDayFocus } from "@/lib/utils";

interface WorkoutWithSets extends WorkoutLog {
  sets: SetLog[];
}

export default function HistoryPage() {
  const { data: workouts, isLoading } = useQuery<WorkoutWithSets[]>({
    queryKey: ["/api/workouts/history"],
  });

  const { data: exercises } = useQuery<Exercise[]>({
    queryKey: ["/api/exercises"],
  });

  const { data: user } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  const activeProgram = user?.activeProgram || "phase3";

  const exerciseMap = exercises?.reduce((acc, ex) => {
    acc[ex.id] = ex;
    return acc;
  }, {} as Record<string, Exercise>) || {};

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <h1 className="text-2xl font-bold text-primary">Workout History</h1>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  const completedWorkouts = workouts?.filter(w => w.completed) || [];

  if (completedWorkouts.length === 0) {
    return (
      <div className="p-4 space-y-4">
        <h1 className="text-2xl font-bold text-primary" data-testid="text-history-title">Workout History</h1>
        <Card>
          <CardContent className="p-6 text-center">
            <Dumbbell className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No completed workouts yet.</p>
            <p className="text-sm text-muted-foreground mt-2">
              Complete a workout by logging all your sets and they'll appear here.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const groupSetsByExercise = (sets: SetLog[]) => {
    const grouped: Record<string, SetLog[]> = {};
    sets.forEach((set) => {
      if (!grouped[set.exerciseId]) {
        grouped[set.exerciseId] = [];
      }
      grouped[set.exerciseId].push(set);
    });
    return grouped;
  };

  return (
    <div className="p-4 space-y-4 pb-24">
      <h1 className="text-2xl font-bold text-primary" data-testid="text-history-title">Workout History</h1>
      <p className="text-muted-foreground text-sm">
        {completedWorkouts.length} completed workout{completedWorkouts.length !== 1 ? "s" : ""}
      </p>

      {completedWorkouts.map((workout) => {
        const groupedSets = groupSetsByExercise(workout.sets);
        
        return (
          <Card key={workout.id} data-testid={`card-workout-${workout.id}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-lg">Day {workout.day} — {getDayName(workout.day)} — {getDayFocus(workout.day, workout.program || activeProgram)}</CardTitle>
                  <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                    <Calendar className="w-4 h-4" />
                    <span>{format(new Date(workout.date), "MMM d, yyyy")}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant="secondary">Week {workout.week}</Badge>
                  {workout.duration && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span>{workout.duration} min</span>
                    </div>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              {Object.entries(groupedSets).length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No sets logged</p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(groupedSets).map(([exerciseId, sets]) => {
                    const exercise = exerciseMap[exerciseId];
                    const sortedSets = [...sets].sort((a, b) => a.setNumber - b.setNumber);
                    
                    return (
                      <div key={exerciseId} className="bg-card-alt rounded-md p-3">
                        <p className="font-medium text-sm mb-2">
                          {exercise?.name || "Unknown Exercise"}
                        </p>
                        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground mb-1">
                          <span>Set</span>
                          <span>Weight</span>
                          <span>Reps</span>
                        </div>
                        {sortedSets.map((set) => (
                          <div key={set.id} className="grid grid-cols-3 gap-2 text-sm py-1 border-t border-border/50">
                            <span>{set.setNumber}{set.side === "left" ? "L" : set.side === "right" ? "R" : ""}</span>
                            <span>{set.weightLbs ? `${set.weightLbs} lbs` : set.durationSecs ? `${set.durationSecs}s` : "—"}</span>
                            <span>{set.reps || "—"}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
              {workout.notes && (
                <p className="text-sm text-muted-foreground mt-3 italic">"{workout.notes}"</p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
