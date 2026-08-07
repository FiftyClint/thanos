import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, RotateCcw } from "lucide-react";

interface TrackingTimerProps {
  onTimeCapture: (seconds: number) => void;
  initialValue?: number;
}

export function TrackingTimer({ onTimeCapture, initialValue = 0 }: TrackingTimerProps) {
  const [seconds, setSeconds] = useState(initialValue);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isRunning) {
      interval = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning]);

  const handleStartStop = useCallback(() => {
    if (isRunning) {
      setIsRunning(false);
      onTimeCapture(seconds);
    } else {
      setIsRunning(true);
    }
  }, [isRunning, seconds, onTimeCapture]);

  const handleReset = useCallback(() => {
    setIsRunning(false);
    setSeconds(0);
  }, []);

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins}:${remainingSecs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`font-mono text-xl font-bold min-w-[60px] text-center ${isRunning ? "text-accent" : ""}`}>
        {formatTime(seconds)}
      </div>
      <Button
        size="icon"
        variant={isRunning ? "default" : "secondary"}
        onClick={handleStartStop}
        data-testid="button-timer-toggle"
      >
        {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={handleReset}
        disabled={isRunning || seconds === 0}
        data-testid="button-timer-reset"
      >
        <RotateCcw className="w-4 h-4" />
      </Button>
    </div>
  );
}
