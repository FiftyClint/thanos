import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, wasQueued } from "@/lib/queryClient";
import { getCurrentWeek, getCurrentPhase, getDayName, getDayFocus, formatTime, parseRestSeconds, isDeloadWeek } from "@/lib/utils";
import { usePrep } from "@/hooks/use-prep";
import ProgramSelector from "@/components/ProgramSelector";
import { ChevronDown, ChevronUp, Play, Clock, Timer, AlertTriangle, CheckCircle2, X, Pause, RotateCcw, Download, Plus, ArrowLeftRight } from "lucide-react";
import type { Exercise, SetLog, WorkoutLog, User } from "@shared/schema";

function TimedSetRow({
  set,
  idx,
  exerciseId,
  exercise,
  updateSet,
  handleSetComplete,
}: {
  set: SetData;
  idx: number;
  exerciseId: string;
  exercise: Exercise;
  updateSet: (exerciseId: string, setIndex: number, field: keyof SetData, value: any) => void;
  handleSetComplete: (exercise: Exercise, setIndex: number) => void;
}) {
  const [seconds, setSeconds] = useState(set.durationSecs || 0);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isRunning) {
      interval = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning]);

  const handleStartStop = () => {
    if (isRunning) {
      setIsRunning(false);
      updateSet(exerciseId, idx, "durationSecs", seconds);
    } else {
      setIsRunning(true);
    }
  };

  const handleReset = () => {
    setIsRunning(false);
    setSeconds(0);
    updateSet(exerciseId, idx, "durationSecs", 0);
  };

  const formatTimerDisplay = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins}:${remainingSecs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-2 bg-card-alt p-3 rounded-md">
      <span className="w-8 text-center font-medium">{set.setNumber}</span>
      <div className={`font-mono text-xl font-bold min-w-[70px] text-center ${isRunning ? "text-accent" : ""}`}>
        {formatTimerDisplay(seconds)}
      </div>
      <Button
        size="icon"
        variant={isRunning ? "default" : "secondary"}
        onClick={handleStartStop}
        data-testid={`button-timer-toggle-${idx}`}
      >
        {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={handleReset}
        disabled={isRunning || seconds === 0}
        data-testid={`button-timer-reset-${idx}`}
      >
        <RotateCcw className="w-4 h-4" />
      </Button>
      <div className="flex-1" />
      <Checkbox
        checked={set.completed}
        onCheckedChange={() => {
          if (!set.completed) {
            setIsRunning(false);
            if (seconds > 0) {
              updateSet(exerciseId, idx, "durationSecs", seconds);
            }
          }
          handleSetComplete(exercise, idx);
        }}
        className="w-8 h-8"
        data-testid={`checkbox-set-${idx}`}
      />
    </div>
  );
}

type WeightSource = "accepted_recommendation" | "pending_recommendation" | "last_session" | "auto_reduce" | "no_history" | "deload" | "user_edited";

interface SetData {
  setNumber: number;
  side?: string;
  weightLbs?: number;
  reps?: number;
  durationSecs?: number;
  rirActual?: number;
  bandNote?: string;
  cardioNotes?: string;
  completed: boolean;
  weightSource?: WeightSource;
  recommendedWeight?: number;
  recommendedReps?: number;
}

interface ExerciseWithSets extends Exercise {
  sets: SetData[];
  previousSets?: SetLog[];
}

export default function Workout() {
  const params = useParams<{ day: string }>();
  const day = parseInt(params.day || "1", 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const { currentWeek } = usePrep();
  const phase = getCurrentPhase(currentWeek);
  const isDeload = isDeloadWeek(currentWeek);
  
  const [expandedExercises, setExpandedExercises] = useState<Set<string>>(new Set());
  const [exerciseData, setExerciseData] = useState<Map<string, SetData[]>>(new Map());
  const [sessionNotes, setSessionNotes] = useState("");
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  
  // Rest timer state
  const [restTimer, setRestTimer] = useState<{
    active: boolean;
    exerciseName: string;
    remaining: number;
    total: number;
  } | null>(null);

  const { data: user } = useQuery<User | null>({ queryKey: ["/api/user"] });
  const activeProgram = user?.activeProgram || 'phase3';

  const { data: exercises, isLoading: exercisesLoading } = useQuery<Exercise[]>({
    queryKey: [`/api/exercises/${day}?week=${currentWeek}`],
  });

  const { data: currentWorkout } = useQuery<WorkoutLog>({
    queryKey: ["/api/workouts/current", day, currentWeek],
  });

  const { data: previousSets } = useQuery<SetLog[]>({
    queryKey: ["/api/sets/previous", day],
  });

  // Smart weight recommendations
  const { data: weightRecommendations, isFetched: recommendationsFetched } = useQuery<Record<string, Array<{
    setNumber: number;
    side?: string;
    weight: number | null;
    reps: number | null;
    source: string;
    reason?: string;
    lastSessionDate?: Date;
  }>>>({
    queryKey: [`/api/sets/recommendations/${day}?week=${currentWeek}`],
  });

  // Session timer
  useEffect(() => {
    if (sessionStartTime) {
      const interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - sessionStartTime.getTime()) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [sessionStartTime]);

  // Audio notification for rest timer
  const playTimerSound = useCallback(() => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.frequency.value = 880;
      oscillator.type = "sine";
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
      console.log("Audio not supported");
    }
  }, []);

  // Rest timer countdown
  useEffect(() => {
    if (restTimer && restTimer.active && restTimer.remaining > 0) {
      const timeout = setTimeout(() => {
        setRestTimer((prev) => prev ? { ...prev, remaining: prev.remaining - 1 } : null);
      }, 1000);
      return () => clearTimeout(timeout);
    } else if (restTimer && restTimer.remaining <= 0 && restTimer.active) {
      playTimerSound();
      setRestTimer((prev) => prev ? { ...prev, active: false } : null);
      setTimeout(() => setRestTimer(null), 5000);
    }
  }, [restTimer, playTimerSound]);

  // Initialize exercise data with smart weight recommendations
  useEffect(() => {
    if (exercises && exercises.length > 0 && !exerciseData.size && recommendationsFetched) {
      const newData = new Map<string, SetData[]>();
      exercises.forEach((ex) => {
        const numSets = isDeload ? Math.max(2, ex.defaultSets - (ex.defaultSets > 3 ? 2 : 1)) : ex.defaultSets;
        const sets: SetData[] = [];
        
        const exRecs = (weightRecommendations && weightRecommendations[ex.id]) || [];
        
        if (ex.inputType === "weight_reps_unilateral" || ex.inputType === "weight_reps_unilateral_db" || ex.inputType === "reps_unilateral_band" || ex.inputType === "timed_reps") {
          for (let i = 1; i <= numSets; i++) {
            const leftRec = exRecs.find((r) => r.setNumber === i && r.side === "left");
            const rightRec = exRecs.find((r) => r.setNumber === i && r.side === "right");
            sets.push({
              setNumber: i,
              side: "left",
              weightLbs: leftRec?.weight ?? undefined,
              reps: undefined,
              completed: false,
              weightSource: (leftRec?.source as WeightSource) || "no_history",
              recommendedWeight: leftRec?.weight ?? undefined,
              recommendedReps: leftRec?.reps ?? undefined,
            });
            sets.push({
              setNumber: i,
              side: "right",
              weightLbs: rightRec?.weight ?? undefined,
              reps: undefined,
              completed: false,
              weightSource: (rightRec?.source as WeightSource) || "no_history",
              recommendedWeight: rightRec?.weight ?? undefined,
              recommendedReps: rightRec?.reps ?? undefined,
            });
          }
        } else if (ex.inputType === "cardio") {
          sets.push({ setNumber: 1, completed: false });
        } else {
          for (let i = 1; i <= numSets; i++) {
            const rec = exRecs.find((r) => r.setNumber === i && !r.side);
            sets.push({
              setNumber: i,
              weightLbs: rec?.weight ?? undefined,
              reps: undefined,
              completed: false,
              weightSource: (rec?.source as WeightSource) || "no_history",
              recommendedWeight: rec?.weight ?? undefined,
              recommendedReps: rec?.reps ?? undefined,
            });
          }
        }
        newData.set(ex.id, sets);
      });
      setExerciseData(newData);
    }
  }, [exercises, recommendationsFetched, weightRecommendations, isDeload]);

  const toggleExpanded = (id: string) => {
    setExpandedExercises((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateSet = (exerciseId: string, setIndex: number, field: keyof SetData, value: any) => {
    setExerciseData((prev) => {
      const newData = new Map(prev);
      const sets = [...(newData.get(exerciseId) || [])];
      const currentSet = sets[setIndex];
      
      // Track if user edited the weight differently from the recommendation
      if (field === "weightLbs" && currentSet.recommendedWeight !== undefined) {
        const isUserEdit = value !== currentSet.recommendedWeight;
        sets[setIndex] = { 
          ...currentSet, 
          [field]: value,
          weightSource: isUserEdit ? "user_edited" : currentSet.weightSource,
        };
      } else {
        sets[setIndex] = { ...currentSet, [field]: value };
      }
      
      newData.set(exerciseId, sets);
      return newData;
    });
    
    if (!sessionStartTime) {
      setSessionStartTime(new Date());
    }
  };

  const [swappedExercises, setSwappedExercises] = useState<Set<string>>(new Set());

  const toggleSwap = (exerciseId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSwappedExercises((prev) => {
      const next = new Set(prev);
      if (next.has(exerciseId)) next.delete(exerciseId);
      else next.add(exerciseId);
      return next;
    });
  };

  const addSet = (exercise: Exercise) => {
    setExerciseData((prev) => {
      const newData = new Map(prev);
      const sets = [...(newData.get(exercise.id) || [])];
      const isUnilateral = exercise.inputType === "weight_reps_unilateral" ||
                           exercise.inputType === "weight_reps_unilateral_db" ||
                           exercise.inputType === "reps_unilateral_band" ||
                           exercise.inputType === "timed_reps";
      if (isUnilateral) {
        const nextSetNumber = sets.filter(s => s.side === "left").length + 1;
        sets.push({ setNumber: nextSetNumber, side: "left", weightLbs: undefined, reps: undefined, completed: false, weightSource: "no_history" });
        sets.push({ setNumber: nextSetNumber, side: "right", weightLbs: undefined, reps: undefined, completed: false, weightSource: "no_history" });
      } else {
        sets.push({ setNumber: sets.length + 1, weightLbs: undefined, reps: undefined, completed: false, weightSource: "no_history" });
      }
      newData.set(exercise.id, sets);
      return newData;
    });
  };

  const handleSetComplete = (exercise: Exercise, setIndex: number) => {
    updateSet(exercise.id, setIndex, "completed", true);
    
    // Start rest timer (skip for first exercise in superset)
    if (exercise.isSupersetPart && exercise.number.endsWith("a")) {
      return;
    }
    
    const restSecs = parseRestSeconds(exercise.restSeconds);
    setRestTimer({
      active: true,
      exerciseName: exercise.name,
      remaining: restSecs,
      total: restSecs,
    });
  };

  const completeWorkoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/workouts/complete", {
        day,
        week: currentWeek,
        phase,
        program: activeProgram,
        duration: elapsedTime ? Math.floor(elapsedTime / 60) : undefined,
        notes: sessionNotes,
        sets: Array.from(exerciseData.entries()).flatMap(([exerciseId, sets]) =>
          sets.filter((s) => s.completed).map((s) => ({
            exerciseId,
            ...s,
          }))
        ),
      });
      return { queued: wasQueued(res), data: await res.json() };
    },
    onSuccess: ({ queued }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/workouts"] });
      toast({
        title: "Workout Completed",
        description: queued
          ? "Saved on this device — it'll upload as soon as you're back online."
          : "Great work! Your session has been saved.",
      });
      setLocation("/");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getPreviousSummary = (exerciseId: string): string => {
    const prevSets = previousSets?.filter((s) => s.exerciseId === exerciseId) || [];
    if (!prevSets.length) return "";
    
    const summary = prevSets
      .filter((s) => !s.side || s.side === "left")
      .map((s) => {
        if (s.weightLbs && s.reps) return `${s.weightLbs}×${s.reps}`;
        if (s.durationSecs) return `${s.durationSecs}s`;
        if (s.reps) return `${s.reps}`;
        return "";
      })
      .filter(Boolean)
      .join(", ");
    
    return summary ? `Last: ${summary}` : "";
  };

  const getSuggestionSummary = (exerciseId: string, exercise: Exercise): string => {
    const sets = exerciseData.get(exerciseId) || [];
    if (!sets.length) return "";
    
    const isWeighted = exercise.inputType === "weight_reps" || 
      exercise.inputType === "weight_reps_db" ||
      exercise.inputType === "weight_reps_unilateral" ||
      exercise.inputType === "weight_reps_unilateral_db" ||
      exercise.inputType === "bodyweight_reps_weighted";
    
    const firstSet = sets.find(s => !s.side || s.side === "left");
    if (!firstSet) return "";
    
    const parts: string[] = [];
    if (isWeighted && firstSet.recommendedWeight) {
      parts.push(`${firstSet.recommendedWeight} lbs`);
    }
    if (firstSet.recommendedReps) {
      parts.push(`${firstSet.recommendedReps} reps`);
    }
    
    if (!parts.length) return "";
    return parts.join(" / ");
  };

  const getTimerColor = () => {
    if (!restTimer) return "";
    const pct = restTimer.remaining / restTimer.total;
    if (pct > 0.5) return "timer-green";
    if (pct > 0.25) return "timer-yellow";
    return "timer-red";
  };

  const groupExercisesBySuperset = (exercises: Exercise[]) => {
    const groups: Exercise[][] = [];
    let currentGroup: Exercise[] = [];
    
    exercises.forEach((ex, i) => {
      if (ex.supersetGroup) {
        currentGroup.push(ex);
        const nextEx = exercises[i + 1];
        if (!nextEx || nextEx.supersetGroup !== ex.supersetGroup) {
          groups.push([...currentGroup]);
          currentGroup = [];
        }
      } else {
        groups.push([ex]);
      }
    });
    
    return groups;
  };

  // State for collapsible warm-up and cool-down sections
  const [warmupExpanded, setWarmupExpanded] = useState(true);
  const [cooldownExpanded, setCooldownExpanded] = useState(true);
  const [finisherExpanded, setFinisherExpanded] = useState(true);

  // Track warm-up/cool-down completion
  const [segmentCompleted, setSegmentCompleted] = useState<Map<string, boolean>>(new Map());
  
  // Track ramp set weights (for warm-up exercises that need weight input)
  const [rampSetWeights, setRampSetWeights] = useState<Map<string, number>>(new Map());

  const handleSegmentExerciseComplete = (exerciseId: string) => {
    setSegmentCompleted((prev) => {
      const next = new Map(prev);
      next.set(exerciseId, !prev.get(exerciseId));
      return next;
    });
    if (!sessionStartTime) {
      setSessionStartTime(new Date());
    }
  };

  const updateRampSetWeight = (exerciseId: string, weight: number) => {
    setRampSetWeights((prev) => {
      const next = new Map(prev);
      next.set(exerciseId, weight);
      return next;
    });
  };

  // Separate exercises by segment
  const warmupExercises = exercises?.filter((ex) => (ex as any).segment === "warmup") || [];
  const workingExercises = exercises?.filter((ex) => (ex as any).segment === "working" || !(ex as any).segment) || [];
  const finisherExercises = exercises?.filter((ex) => (ex as any).segment === "finisher") || [];
  const cooldownExercises = exercises?.filter((ex) => (ex as any).segment === "cooldown") || [];

  // Check if a segment is fully completed
  const isSegmentComplete = (segmentExercises: Exercise[]) => {
    return segmentExercises.length > 0 && segmentExercises.every((ex) => segmentCompleted.get(ex.id));
  };

  const exportWorkoutCSV = () => {
    const allExercises = [
      ...warmupExercises.map((ex) => ({ ...ex, _segmentLabel: "Warm-Up" })),
      ...workingExercises.map((ex) => ({ ...ex, _segmentLabel: "Working Sets" })),
      ...finisherExercises.map((ex) => ({ ...ex, _segmentLabel: "Finisher" })),
      ...cooldownExercises.map((ex) => ({ ...ex, _segmentLabel: "Cool-Down" })),
    ];

    const escape = (val: string | null | undefined) => {
      const s = String(val ?? "").replace(/"/g, '""');
      return `"${s}"`;
    };

    const headers = ["Segment", "#", "Exercise", "Sets", "Reps / Prescription", "Tempo", "RIR", "Rest", "Notes", "Video URL"];
    const rows = allExercises.map((ex) => [
      escape(ex._segmentLabel),
      escape(ex.number),
      escape(ex.name),
      escape(String(ex.defaultSets)),
      escape(ex.repRange),
      escape(ex.tempo),
      escape(ex.rir),
      escape(ex.restSeconds),
      escape(ex.notes),
      escape(ex.videoUrl),
    ]);

    const dayLabel = `Day ${day} - ${getDayName(day)} - ${getDayFocus(day, activeProgram)}`;
    const metaRow = `"Thanos Program — ${dayLabel} — Week ${currentWeek} (${phase})"`;
    const csv = [metaRow, "", headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `thanos-day${day}-week${currentWeek}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Check if it's a ramp set (weight input needed)
  const isRampSet = (exercise: Exercise) => {
    return exercise.name.includes("RAMP SET");
  };

  if (exercisesLoading) {
    return (
      <div className="min-h-screen bg-background p-4 pb-24">
        <div className="max-w-2xl mx-auto space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  const workingGroups = groupExercisesBySuperset(workingExercises);
  const finisherGroups = groupExercisesBySuperset(finisherExercises);

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Rest Timer Overlay */}
      {restTimer && (
        <div 
          className={`fixed top-0 left-0 right-0 z-50 ${restTimer.remaining > 0 ? getTimerColor() : "bg-green-600"} px-4 py-3`}
          data-testid="rest-timer"
        >
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Timer className="w-5 h-5" />
              {restTimer.remaining > 0 ? (
                <>
                  <span className="font-medium text-lg">{formatTime(restTimer.remaining)}</span>
                  <span className="text-sm opacity-75 truncate max-w-[150px]">{restTimer.exerciseName}</span>
                </>
              ) : (
                <span className="font-bold text-lg">REST COMPLETE!</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {restTimer.remaining > 0 && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRestTimer((prev) => prev ? { ...prev, remaining: prev.remaining + 30 } : null)}
                    data-testid="button-add-30"
                  >
                    +30s
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRestTimer(null)}
                data-testid="button-skip-rest"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {restTimer.remaining > 0 && (
            <div className="max-w-2xl mx-auto mt-2">
              <div className="h-1.5 bg-black/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white/80 transition-all duration-1000"
                  style={{ width: `${(restTimer.remaining / restTimer.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Rest Timer Buttons (when no timer active) */}
      {!restTimer && sessionStartTime && (
        <div className="fixed bottom-20 right-4 z-40" data-testid="quick-rest-buttons">
          <div className="flex flex-col gap-2">
            {[60, 90, 120, 180].map((secs) => (
              <Button
                key={secs}
                size="sm"
                variant="secondary"
                className="w-14 h-10 text-xs font-medium"
                onClick={() => setRestTimer({ active: true, exerciseName: "Quick Rest", remaining: secs, total: secs })}
                data-testid={`button-rest-${secs}`}
              >
                {secs >= 60 ? `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, "0")}` : `${secs}s`}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {/* Header */}
        <div className={`${restTimer ? "pt-16" : ""}`}>
          <div className="flex items-center justify-between mb-2">
            <Badge variant="secondary" className="text-xs">
              Week {currentWeek} • {phase}
            </Badge>
            {sessionStartTime && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Clock className="w-4 h-4" />
                {formatTime(elapsedTime)}
              </div>
            )}
          </div>
          
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-accent" data-testid="workout-title">
                DAY {day} — {getDayName(day).toUpperCase()}
              </h1>
              <p className="text-muted-foreground">{getDayFocus(day, activeProgram)}</p>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <ProgramSelector />
              <Button
                variant="ghost"
                size="sm"
                onClick={exportWorkoutCSV}
                disabled={!exercises?.length}
                data-testid="button-export-workout"
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                title="Export workout to CSV"
              >
                <Download className="w-4 h-4" />
                <span className="text-xs">Export</span>
              </Button>
            </div>
          </div>
          
          {isDeload && (
            <div className="mt-3 flex items-center gap-2 text-warning">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm font-medium">DELOAD WEEK — Reduced volume</span>
            </div>
          )}
        </div>

        {/* WARM-UP Section */}
        {warmupExercises.length > 0 && (
          <Collapsible open={warmupExpanded} onOpenChange={setWarmupExpanded}>
            <div className="rounded-lg bg-header overflow-hidden" data-testid="section-warmup">
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between p-4 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-lg">WARM-UP</span>
                    {isSegmentComplete(warmupExercises) && (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {warmupExercises.filter((ex) => segmentCompleted.get(ex.id)).length}/{warmupExercises.length}
                    </span>
                    {warmupExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4 space-y-2">
                  {warmupExercises.map((exercise) => (
                    <div
                      key={exercise.id}
                      className="flex items-center gap-3 bg-card/50 p-3 rounded-md"
                      data-testid={`warmup-exercise-${exercise.number}`}
                    >
                      <Checkbox
                        checked={segmentCompleted.get(exercise.id) || false}
                        onCheckedChange={() => handleSegmentExerciseComplete(exercise.id)}
                        className="w-6 h-6"
                        data-testid={`checkbox-warmup-${exercise.number}`}
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-accent">{exercise.number}</span>
                          <span className={`text-sm ${segmentCompleted.get(exercise.id) ? "line-through opacity-50" : ""}`}>
                            {exercise.name}
                          </span>
                          {exercise.videoUrl && (
                            <a
                              href={exercise.videoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-link hover:text-link/80"
                            >
                              <Play className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">{exercise.repRange}</span>
                      </div>
                      {/* Ramp sets get weight input */}
                      {isRampSet(exercise) && (
                        <Input
                          type="number"
                          inputMode="decimal"
                          placeholder="lbs"
                          className="h-9 w-16 text-sm"
                          value={rampSetWeights.get(exercise.id) || ""}
                          onChange={(e) => updateRampSetWeight(exercise.id, parseFloat(e.target.value || "0"))}
                          data-testid={`input-warmup-weight-${exercise.number}`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        )}

        {/* WORKING SETS Section */}
        <div className="space-y-4">
          <div className="font-bold text-lg text-muted-foreground">WORKING SETS</div>
          {workingGroups.map((group, groupIdx) => (
            <div
              key={groupIdx}
              className={group.length > 1 ? "superset-highlight rounded-lg p-3 space-y-3" : ""}
            >
              {group.length > 1 && (
                <div className="text-xs text-muted-foreground font-medium mb-2">
                  SUPERSET {group[0].supersetGroup}
                </div>
              )}
              
              {group.map((exercise) => {
                const isExpanded = expandedExercises.has(exercise.id);
                const sets = exerciseData.get(exercise.id) || [];
                const prevSummary = getPreviousSummary(exercise.id);
                const suggestionSummary = getSuggestionSummary(exercise.id, exercise);
                const isUnilateral = exercise.inputType === "weight_reps_unilateral" ||
                  exercise.inputType === "weight_reps_unilateral_db" ||
                  exercise.inputType === "reps_unilateral_band" ||
                  exercise.inputType === "timed_reps";
                const unilateralSetNums = isUnilateral
                  ? Array.from(new Set(sets.map((s) => s.setNumber)))
                  : null;
                const completedSets = isUnilateral
                  ? unilateralSetNums!.filter((n) =>
                      sets.find((s) => s.setNumber === n && s.side === "left")?.completed &&
                      sets.find((s) => s.setNumber === n && s.side === "right")?.completed
                    ).length
                  : sets.filter((s) => s.completed).length;
                const totalSets = isUnilateral ? unilateralSetNums!.length : sets.length;
                const isSwapped = swappedExercises.has(exercise.id);
                const displayName = isSwapped && exercise.alternate ? exercise.alternate : exercise.name;
                
                return (
                  <Card key={exercise.id} data-testid={`card-exercise-${exercise.number}`}>
                    <Collapsible open={isExpanded} onOpenChange={() => toggleExpanded(exercise.id)}>
                      <CollapsibleTrigger asChild>
                        <CardHeader className="cursor-pointer pb-2" data-testid={`header-exercise-${exercise.number}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-accent">{exercise.number}</span>
                                <span className="font-semibold">{displayName}</span>
                                {isSwapped && (
                                  <Badge variant="outline" className="text-xs px-1.5 py-0 text-muted-foreground border-muted-foreground/40">ALT</Badge>
                                )}
                                {exercise.videoUrl && (
                                  <a
                                    href={exercise.videoUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-link hover:text-link/80"
                                    data-testid={`link-video-${exercise.number}`}
                                  >
                                    <Play className="w-4 h-4" />
                                  </a>
                                )}
                                {exercise.alternate && (
                                  <button
                                    onClick={(e) => toggleSwap(exercise.id, e)}
                                    className={`transition-colors ${isSwapped ? "text-accent" : "text-muted-foreground hover:text-foreground"}`}
                                    title={isSwapped ? `Switch back to ${exercise.name}` : `Swap to ${exercise.alternate}`}
                                    data-testid={`button-swap-${exercise.number}`}
                                  >
                                    <ArrowLeftRight className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                              {isSwapped && exercise.alternate && (
                                <div className="text-xs text-muted-foreground/60 mt-0.5 line-through">{exercise.name}</div>
                              )}
                              {suggestionSummary && (
                                <div className="text-sm text-accent/80 mt-1 font-medium" data-testid={`text-suggestion-${exercise.number}`}>
                                  Suggested: {suggestionSummary}
                                </div>
                              )}
                              {prevSummary && (
                                <div className="text-xs text-muted-foreground mt-0.5">{prevSummary}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">
                                {completedSets}/{totalSets}
                              </span>
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 mt-2">
                            <Badge variant="secondary" className="text-xs">{exercise.repRange}</Badge>
                            {exercise.tempo !== "—" && (
                              <Badge variant="secondary" className="text-xs">Tempo: {exercise.tempo}</Badge>
                            )}
                            {exercise.rir && exercise.rir !== "—" && (
                              <Badge variant="secondary" className="text-xs">RIR: {exercise.rir}</Badge>
                            )}
                            <Badge variant="secondary" className="text-xs">{exercise.restSeconds}</Badge>
                          </div>
                        </CardHeader>
                      </CollapsibleTrigger>
                      
                      <CollapsibleContent>
                        <CardContent className="pt-2">
                          {exercise.notes && (
                            <div className="text-sm text-muted-foreground mb-3 italic">
                              {exercise.notes}
                            </div>
                          )}
                          
                          {/* Set Logging Table */}
                          <div className="space-y-2">
                            {renderSetInputs(exercise, sets, updateSet, handleSetComplete)}
                          </div>
                          {exercise.inputType !== "cardio" && (
                            <button
                              onClick={() => addSet(exercise)}
                              className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-accent transition-colors"
                              data-testid={`button-add-set-${exercise.number}`}
                            >
                              <Plus className="w-3 h-3" />
                              Add Set
                            </button>
                          )}
                        </CardContent>
                      </CollapsibleContent>
                    </Collapsible>
                  </Card>
                );
              })}
            </div>
          ))}
        </div>

        {/* FINISHER Section */}
        {finisherExercises.length > 0 && (
          <Collapsible open={finisherExpanded} onOpenChange={setFinisherExpanded}>
            <div className="rounded-lg bg-card border border-accent/30 overflow-hidden" data-testid="section-finisher">
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between p-4 cursor-pointer bg-accent/10">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-accent text-white">FINISHER</Badge>
                  </div>
                  {finisherExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4 space-y-3">
                  {finisherGroups.map((group, groupIdx) => (
                    <div key={groupIdx}>
                      {group.map((exercise) => {
                        const isExpanded = expandedExercises.has(exercise.id);
                        const sets = exerciseData.get(exercise.id) || [];
                        const isUnilateralF = exercise.inputType === "weight_reps_unilateral" ||
                          exercise.inputType === "weight_reps_unilateral_db" ||
                          exercise.inputType === "reps_unilateral_band" ||
                          exercise.inputType === "timed_reps";
                        const unilateralSetNumsF = isUnilateralF
                          ? Array.from(new Set(sets.map((s) => s.setNumber)))
                          : null;
                        const completedSets = isUnilateralF
                          ? unilateralSetNumsF!.filter((n) =>
                              sets.find((s) => s.setNumber === n && s.side === "left")?.completed &&
                              sets.find((s) => s.setNumber === n && s.side === "right")?.completed
                            ).length
                          : sets.filter((s) => s.completed).length;
                        const totalSets = isUnilateralF ? unilateralSetNumsF!.length : sets.length;
                        const isSwapped = swappedExercises.has(exercise.id);
                        const displayName = isSwapped && exercise.alternate ? exercise.alternate : exercise.name;
                        
                        return (
                          <Card key={exercise.id} data-testid={`card-finisher-${exercise.number}`}>
                            <Collapsible open={isExpanded} onOpenChange={() => toggleExpanded(exercise.id)}>
                              <CollapsibleTrigger asChild>
                                <CardHeader className="cursor-pointer pb-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-bold text-accent">{exercise.number}</span>
                                        <span className="font-semibold">{displayName}</span>
                                        {isSwapped && (
                                          <Badge variant="outline" className="text-xs px-1.5 py-0 text-muted-foreground border-muted-foreground/40">ALT</Badge>
                                        )}
                                        {exercise.videoUrl && (
                                          <a
                                            href={exercise.videoUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            className="text-link hover:text-link/80"
                                          >
                                            <Play className="w-4 h-4" />
                                          </a>
                                        )}
                                        {exercise.alternate && (
                                          <button
                                            onClick={(e) => toggleSwap(exercise.id, e)}
                                            className={`transition-colors ${isSwapped ? "text-accent" : "text-muted-foreground hover:text-foreground"}`}
                                            title={isSwapped ? `Switch back to ${exercise.name}` : `Swap to ${exercise.alternate}`}
                                            data-testid={`button-swap-finisher-${exercise.number}`}
                                          >
                                            <ArrowLeftRight className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </div>
                                      {isSwapped && exercise.alternate && (
                                        <div className="text-xs text-muted-foreground/60 mt-0.5 line-through">{exercise.name}</div>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm text-muted-foreground">
                                        {completedSets}/{totalSets}
                                      </span>
                                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap gap-2 mt-2">
                                    <Badge variant="secondary" className="text-xs">{exercise.repRange}</Badge>
                                    <Badge variant="secondary" className="text-xs">{exercise.restSeconds}</Badge>
                                  </div>
                                </CardHeader>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <CardContent className="pt-2">
                                  {exercise.notes && (
                                    <div className="text-sm text-muted-foreground mb-3 italic">
                                      {exercise.notes}
                                    </div>
                                  )}
                                  <div className="space-y-2">
                                    {renderSetInputs(exercise, sets, updateSet, handleSetComplete)}
                                  </div>
                                  {exercise.inputType !== "cardio" && (
                                    <button
                                      onClick={() => addSet(exercise)}
                                      className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-accent transition-colors"
                                      data-testid={`button-add-set-finisher-${exercise.number}`}
                                    >
                                      <Plus className="w-3 h-3" />
                                      Add Set
                                    </button>
                                  )}
                                </CardContent>
                              </CollapsibleContent>
                            </Collapsible>
                          </Card>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        )}

        {/* COOL-DOWN Section */}
        {cooldownExercises.length > 0 && (
          <Collapsible open={cooldownExpanded} onOpenChange={setCooldownExpanded}>
            <div className="rounded-lg bg-header overflow-hidden" data-testid="section-cooldown">
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between p-4 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-lg">COOL-DOWN</span>
                    {isSegmentComplete(cooldownExercises) && (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {cooldownExercises.filter((ex) => segmentCompleted.get(ex.id)).length}/{cooldownExercises.length}
                    </span>
                    {cooldownExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 pb-4 space-y-2">
                  {cooldownExercises.map((exercise) => (
                    <div
                      key={exercise.id}
                      className="flex items-center gap-3 bg-card/50 p-3 rounded-md"
                      data-testid={`cooldown-exercise-${exercise.number}`}
                    >
                      <Checkbox
                        checked={segmentCompleted.get(exercise.id) || false}
                        onCheckedChange={() => handleSegmentExerciseComplete(exercise.id)}
                        className="w-6 h-6"
                        data-testid={`checkbox-cooldown-${exercise.number}`}
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-accent">{exercise.number}</span>
                          <span className={`text-sm ${segmentCompleted.get(exercise.id) ? "line-through opacity-50" : ""}`}>
                            {exercise.name}
                          </span>
                          {exercise.videoUrl && (
                            <a
                              href={exercise.videoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-link hover:text-link/80"
                            >
                              <Play className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">{exercise.repRange}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        )}

        {/* Session Notes */}
        <Card>
          <CardContent className="p-4">
            <Textarea
              placeholder="Session notes..."
              value={sessionNotes}
              onChange={(e) => setSessionNotes(e.target.value)}
              className="resize-none"
              data-testid="input-session-notes"
            />
          </CardContent>
        </Card>

        {/* Complete Button */}
        <Button
          className="w-full h-14 text-lg"
          onClick={() => completeWorkoutMutation.mutate()}
          disabled={completeWorkoutMutation.isPending}
          data-testid="button-complete-workout"
        >
          {completeWorkoutMutation.isPending ? (
            "Saving..."
          ) : (
            <>
              <CheckCircle2 className="w-5 h-5 mr-2" />
              Complete Workout
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function WeightSourceLabel({ source, weight }: { source?: WeightSource; weight?: number }) {
  if (!source || source === "no_history" || !weight) return null;
  
  const labels: Record<WeightSource, { text: string; className: string }> = {
    accepted_recommendation: { text: "↑ Recommended", className: "text-green-500" },
    pending_recommendation: { text: "Last session", className: "text-muted-foreground" },
    last_session: { text: "Last session", className: "text-muted-foreground" },
    auto_reduce: { text: "↓ Auto-adjusted", className: "text-yellow-500" },
    deload: { text: "Deload", className: "text-muted-foreground" },
    user_edited: { text: "", className: "" },
    no_history: { text: "", className: "" },
  };
  
  const label = labels[source];
  if (!label?.text) return null;
  
  return (
    <span className={`text-[10px] ${label.className}`}>{label.text}</span>
  );
}

function renderSetInputs(
  exercise: Exercise,
  sets: SetData[],
  updateSet: (exerciseId: string, setIndex: number, field: keyof SetData, value: any) => void,
  handleSetComplete: (exercise: Exercise, setIndex: number) => void
) {
  const { inputType, id: exerciseId } = exercise;

  if (inputType === "cardio") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Duration (min)</label>
          <Input
            type="number"
            inputMode="numeric"
            className="h-12 text-lg"
            value={sets[0]?.durationSecs ? Math.floor(sets[0].durationSecs / 60) : ""}
            onChange={(e) => updateSet(exerciseId, 0, "durationSecs", parseInt(e.target.value || "0", 10) * 60)}
            data-testid="input-cardio-duration"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Notes</label>
          <Input
            type="text"
            className="h-12"
            value={sets[0]?.cardioNotes || ""}
            onChange={(e) => updateSet(exerciseId, 0, "cardioNotes", e.target.value)}
            data-testid="input-cardio-notes"
          />
        </div>
      </div>
    );
  }

  if (inputType === "timed") {
    return (
      <div className="space-y-2">
        {sets.map((set, idx) => (
          <TimedSetRow
            key={idx}
            set={set}
            idx={idx}
            exerciseId={exerciseId}
            exercise={exercise}
            updateSet={updateSet}
            handleSetComplete={handleSetComplete}
          />
        ))}
      </div>
    );
  }

  if (inputType === "weight_reps_unilateral" || inputType === "weight_reps_unilateral_db" || inputType === "reps_unilateral_band" || inputType === "timed_reps") {
    const isWeight = inputType === "weight_reps_unilateral" || inputType === "weight_reps_unilateral_db";
    const isWeightDb = inputType === "weight_reps_unilateral_db";
    const isBand = inputType === "reps_unilateral_band";
    const bandColors = ["Orange", "Red", "Purple", "Green", "Blue"];

    // Group L+R entries by setNumber → one row per set (4 sets = 4 rows, not 8)
    const setNumbers = Array.from(new Set(sets.map((s) => s.setNumber))).sort((a, b) => a - b);

    return (
      <div className="space-y-2">
        {setNumbers.map((setNum) => {
          const leftIdx = sets.findIndex((s) => s.setNumber === setNum && s.side === "left");
          const rightIdx = sets.findIndex((s) => s.setNumber === setNum && s.side === "right");
          const leftSet = sets[leftIdx];
          const rightSet = sets[rightIdx];
          const pairComplete = !!(leftSet?.completed && rightSet?.completed);

          const SideRow = ({ set, idx, label }: { set: SetData | undefined; idx: number; label: string }) => (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-muted-foreground w-3 shrink-0">{label}</span>
              {isWeight && (
                <div className="flex flex-col">
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder={isWeightDb ? "Lbs/Db" : "Lbs"}
                    className="h-10 text-base w-16"
                    value={set?.weightLbs || ""}
                    onChange={(e) => updateSet(exerciseId, idx, "weightLbs", parseFloat(e.target.value || "0"))}
                    data-testid={`input-weight-${idx}`}
                  />
                  <WeightSourceLabel source={set?.weightSource} weight={set?.weightLbs} />
                </div>
              )}
              {isBand && (
                <Select
                  value={set?.bandNote || ""}
                  onValueChange={(value) => updateSet(exerciseId, idx, "bandNote", value)}
                >
                  <SelectTrigger className="h-10 w-20" data-testid={`select-band-${idx}`}>
                    <SelectValue placeholder="Band" />
                  </SelectTrigger>
                  <SelectContent>
                    {bandColors.map((color) => (
                      <SelectItem key={color} value={color}>{color}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                type="number"
                inputMode="numeric"
                placeholder={set?.recommendedReps ? `${set.recommendedReps}` : "Reps"}
                className="h-10 text-base w-14"
                value={set?.reps || ""}
                onChange={(e) => updateSet(exerciseId, idx, "reps", parseInt(e.target.value || "0", 10))}
                data-testid={`input-reps-${idx}`}
              />
            </div>
          );

          return (
            <div key={setNum} className="bg-card-alt p-2 rounded-md">
              <div className="flex items-center gap-2">
                <span className="w-6 text-center font-medium text-sm shrink-0">{setNum}</span>
                <div className="flex-1 space-y-1.5">
                  <SideRow set={leftSet} idx={leftIdx} label="L" />
                  <SideRow set={rightSet} idx={rightIdx} label="R" />
                </div>
                <Checkbox
                  checked={pairComplete}
                  onCheckedChange={() => {
                    // Mark right side complete directly, then handleSetComplete marks left + starts timer
                    updateSet(exerciseId, rightIdx, "completed", true);
                    handleSetComplete(exercise, leftIdx);
                  }}
                  className="w-8 h-8 shrink-0"
                  data-testid={`checkbox-set-${setNum}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (inputType === "bodyweight_reps" || inputType === "bodyweight_reps_weighted") {
    const showWeight = inputType === "bodyweight_reps_weighted";
    
    return (
      <div className="space-y-2">
        {sets.map((set, idx) => (
          <div key={idx} className="flex items-center gap-3 bg-card-alt p-3 rounded-md">
            <span className="w-8 text-center font-medium">{set.setNumber}</span>
            <Input
              type="number"
              inputMode="numeric"
              placeholder={set.recommendedReps ? `${set.recommendedReps}` : "Reps"}
              className="h-12 text-lg flex-1"
              value={set.reps || ""}
              onChange={(e) => updateSet(exerciseId, idx, "reps", parseInt(e.target.value || "0", 10))}
              data-testid={`input-reps-${idx}`}
            />
            {showWeight && (
              <div className="flex flex-col">
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="+lbs"
                  className="h-12 text-lg w-20"
                  value={set.weightLbs || ""}
                  onChange={(e) => updateSet(exerciseId, idx, "weightLbs", parseFloat(e.target.value || "0"))}
                  data-testid={`input-weight-${idx}`}
                />
                <WeightSourceLabel source={set.weightSource} weight={set.weightLbs} />
              </div>
            )}
            <Checkbox
              checked={set.completed}
              onCheckedChange={() => handleSetComplete(exercise, idx)}
              className="w-8 h-8"
              data-testid={`checkbox-set-${idx}`}
            />
          </div>
        ))}
      </div>
    );
  }

  if (inputType === "band_reps") {
    const bandColors = ["Orange", "Red", "Purple", "Green", "Blue"];
    return (
      <div className="space-y-2">
        {sets.map((set, idx) => (
          <div key={idx} className="flex items-center gap-3 bg-card-alt p-3 rounded-md">
            <span className="w-8 text-center font-medium">{set.setNumber}</span>
            <Input
              type="number"
              inputMode="numeric"
              placeholder={set.recommendedReps ? `${set.recommendedReps}` : "Reps"}
              className="h-12 text-lg w-14"
              value={set.reps || ""}
              onChange={(e) => updateSet(exerciseId, idx, "reps", parseInt(e.target.value || "0", 10))}
              data-testid={`input-reps-${idx}`}
            />
            <Select
              value={set.bandNote || ""}
              onValueChange={(value) => updateSet(exerciseId, idx, "bandNote", value)}
            >
              <SelectTrigger className="h-12 w-28" data-testid={`select-band-${idx}`}>
                <SelectValue placeholder="Band" />
              </SelectTrigger>
              <SelectContent>
                {bandColors.map((color) => (
                  <SelectItem key={color} value={color}>{color}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Checkbox
              checked={set.completed}
              onCheckedChange={() => handleSetComplete(exercise, idx)}
              className="w-8 h-8"
              data-testid={`checkbox-set-${idx}`}
            />
          </div>
        ))}
      </div>
    );
  }

  // Default: weight_reps or weight_reps_db
  const isDb = inputType === "weight_reps_db";
  
  return (
    <div className="space-y-2">
      {sets.map((set, idx) => (
        <div key={idx} className="flex items-center gap-2 bg-card-alt p-2 rounded-md">
          <span className="w-6 text-center font-medium text-sm">{set.setNumber}</span>
          <div className="flex flex-col flex-1 min-w-[60px]">
            <Input
              type="number"
              inputMode="decimal"
              placeholder={isDb ? "Lbs/Db" : "Lbs"}
              className="h-11 text-base"
              value={set.weightLbs || ""}
              onChange={(e) => updateSet(exerciseId, idx, "weightLbs", parseFloat(e.target.value || "0"))}
              data-testid={`input-weight-${idx}`}
            />
            <WeightSourceLabel source={set.weightSource} weight={set.weightLbs} />
          </div>
          <Input
            type="number"
            inputMode="numeric"
            placeholder={set.recommendedReps ? `${set.recommendedReps}` : "Reps"}
            className="h-11 text-base w-14"
            value={set.reps || ""}
            onChange={(e) => updateSet(exerciseId, idx, "reps", parseInt(e.target.value || "0", 10))}
            data-testid={`input-reps-${idx}`}
          />
          <Input
            type="number"
            inputMode="numeric"
            placeholder="RIR"
            className="h-11 text-base w-12"
            value={set.rirActual ?? ""}
            onChange={(e) => updateSet(exerciseId, idx, "rirActual", parseInt(e.target.value || "0", 10))}
            data-testid={`input-rir-${idx}`}
          />
          <Checkbox
            checked={set.completed}
            onCheckedChange={() => handleSetComplete(exercise, idx)}
            className="w-7 h-7"
            data-testid={`checkbox-set-${idx}`}
          />
        </div>
      ))}
    </div>
  );
}
