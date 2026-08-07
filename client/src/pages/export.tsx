import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Dumbbell, ClipboardCheck, TrendingUp, Activity, Wind, FileSpreadsheet } from "lucide-react";

export default function Export() {
  const handleExport = async (type: "workouts" | "checkins" | "recommendations" | "cardio" | "vacuum") => {
    const res = await fetch(`/api/export/${type}`, {
      credentials: "include",
    });
    
    if (!res.ok) {
      console.error("Export failed");
      return;
    }
    
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `apex_${type}_${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleProgramExport = async (program: "phase1" | "phase2" | "phase3") => {
    const res = await fetch(`/api/export/program?program=${program}`, {
      credentials: "include",
    });

    if (!res.ok) {
      console.error("Export failed");
      return;
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `thanos_program_${program}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="max-w-2xl mx-auto p-4 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-accent flex items-center gap-2" data-testid="export-title">
            <Download className="w-6 h-6" />
            Export Data
          </h1>
          <p className="text-muted-foreground">Download your training data as CSV files</p>
        </div>

        <Card data-testid="card-export-program">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-accent" />
              Full Training Program
            </CardTitle>
            <CardDescription>
              Every day's exercises (warm-up, working sets, finisher, cool-down) with sets, reps, tempo, RIR, rest, and notes — one tab per day
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={() => handleProgramExport("phase3")}
              className="w-full"
              data-testid="button-export-program-phase3"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Phase 3 Program (.xlsx)
            </Button>
            <Button
              onClick={() => handleProgramExport("phase2")}
              variant="outline"
              className="w-full"
              data-testid="button-export-program-phase2"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Phase 2 Program (.xlsx)
            </Button>
            <Button
              onClick={() => handleProgramExport("phase1")}
              variant="outline"
              className="w-full"
              data-testid="button-export-program-phase1"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Phase 1 Program (.xlsx)
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="card-export-workouts">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Dumbbell className="w-5 h-5 text-accent" />
              Workout History
            </CardTitle>
            <CardDescription>
              All workout logs with date, day, exercise, set, weight, reps, and more
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => handleExport("workouts")}
              className="w-full"
              data-testid="button-export-workouts"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Workout History CSV
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="card-export-checkins">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-accent" />
              Check-In History
            </CardTitle>
            <CardDescription>
              All check-in data including measurements, subjective scores, and notes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => handleExport("checkins")}
              className="w-full"
              data-testid="button-export-checkins"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Check-In History CSV
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="card-export-recommendations">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-accent" />
              Recommendations
            </CardTitle>
            <CardDescription>
              All progression recommendations with status (pending, accepted, dismissed)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => handleExport("recommendations")}
              className="w-full"
              data-testid="button-export-recommendations"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Recommendations CSV
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="card-export-cardio">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-accent" />
              Cardio History
            </CardTitle>
            <CardDescription>
              All cardio sessions with date, type, subtype, duration, and notes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => handleExport("cardio")}
              className="w-full"
              data-testid="button-export-cardio"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Cardio History CSV
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="card-export-vacuum">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wind className="w-5 h-5 text-accent" />
              Vacuum History
            </CardTitle>
            <CardDescription>
              All stomach vacuum sessions with sets, duration, and notes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => handleExport("vacuum")}
              className="w-full"
              data-testid="button-export-vacuum"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Vacuum History CSV
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-card-alt border-dashed">
          <CardContent className="p-4 text-center text-sm text-muted-foreground">
            <p>CSV files can be opened in Excel, Google Sheets, or any spreadsheet application.</p>
            <p className="mt-1">All dates are in your local timezone.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
