import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, wasQueued } from "@/lib/queryClient";
import { getCurrentWeek, getCurrentPhase, calculateShoulderToWaist } from "@/lib/utils";
import { usePrep } from "@/hooks/use-prep";
import { Scale, Ruler, Brain, Camera, Loader2, CheckCircle2 } from "lucide-react";

async function uploadPhotoToStorage(file: File): Promise<string> {
  const res = await fetch("/api/uploads/request-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: file.type,
    }),
  });
  if (!res.ok) throw new Error("Failed to get upload URL");
  const { uploadURL, objectPath } = await res.json();

  const uploadRes = await fetch(uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  if (!uploadRes.ok) throw new Error("Failed to upload photo");

  return objectPath;
}

export default function CheckIn() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { currentWeek } = usePrep();
  const phase = getCurrentPhase(currentWeek);

  const [measurements, setMeasurements] = useState({
    weightLbs: "",
    waistRelaxed: "",
    waistVacuum: "",
    chest: "",
    armsLeft: "",
    armsRight: "",
    shoulders: "",
    thighsLeft: "",
    thighsRight: "",
    calvesLeft: "",
    calvesRight: "",
  });

  const [subjective, setSubjective] = useState({
    sleepQuality: 5,
    energyLevels: 5,
    trainingMotivation: 5,
    hungerAppetite: 5,
    mood: 5,
  });

  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<Record<string, File>>({});

  const swRatio = calculateShoulderToWaist(
    parseFloat(measurements.shoulders) || undefined,
    parseFloat(measurements.waistRelaxed) || undefined
  );

  const submitMutation = useMutation({
    mutationFn: async () => {
      // Photos have to go up over the network; measurements can wait in the
      // offline queue. Offline, the check-in is still saved without them.
      const uploadedPhotos: Array<{ poseType: string; objectPath: string }> = [];
      const photoEntries = Object.entries(photos);
      let photosDeferred = 0;

      if (navigator.onLine) {
        for (const [poseType, file] of photoEntries) {
          const objectPath = await uploadPhotoToStorage(file);
          uploadedPhotos.push({ poseType, objectPath });
        }
      } else {
        photosDeferred = photoEntries.length;
      }

      const data = {
        week: currentWeek,
        phase,
        date: new Date().toISOString(),
        weightLbs: parseFloat(measurements.weightLbs) || null,
        waistRelaxed: parseFloat(measurements.waistRelaxed) || null,
        waistVacuum: parseFloat(measurements.waistVacuum) || null,
        chest: parseFloat(measurements.chest) || null,
        armsLeft: parseFloat(measurements.armsLeft) || null,
        armsRight: parseFloat(measurements.armsRight) || null,
        shoulders: parseFloat(measurements.shoulders) || null,
        thighsLeft: parseFloat(measurements.thighsLeft) || null,
        thighsRight: parseFloat(measurements.thighsRight) || null,
        calvesLeft: parseFloat(measurements.calvesLeft) || null,
        calvesRight: parseFloat(measurements.calvesRight) || null,
        shoulderToWaist: swRatio,
        ...subjective,
        notes,
        photos: uploadedPhotos,
      };

      // apiRequest surfaces the server's validation message and falls back to
      // the offline queue, unlike the bare fetch this replaced.
      const res = await apiRequest("POST", "/api/checkins", data);
      return { queued: wasQueued(res), photosDeferred };
    },
    onSuccess: ({ queued, photosDeferred }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/checkins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/photos"] });

      const description = queued
        ? photosDeferred > 0
          ? `Saved on this device — it'll upload when you're back online. Re-add your ${photosDeferred} photo(s) once you have a connection.`
          : "Saved on this device — it'll upload when you're back online."
        : "Your weekly check-in has been recorded.";

      toast({ title: "Check-In Submitted", description });
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

  const handlePhotoChange = (poseType: string, file: File | null) => {
    if (file) {
      setPhotos((prev) => ({ ...prev, [poseType]: file }));
    } else {
      setPhotos((prev) => {
        const next = { ...prev };
        delete next[poseType];
        return next;
      });
    }
  };

  const poseTypes = [
    { key: "front_relaxed", label: "Front Relaxed" },
    { key: "front_double_bicep", label: "Front Double Bicep" },
    { key: "side_chest_left", label: "Side Chest Left" },
    { key: "side_chest_right", label: "Side Chest Right" },
    { key: "rear_lat_spread", label: "Rear Lat Spread" },
    { key: "rear_double_bicep", label: "Rear Double Bicep" },
  ];

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="max-w-2xl mx-auto p-4 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-accent" data-testid="checkin-title">
            Weekly Check-In
          </h1>
          <p className="text-muted-foreground">Week {currentWeek} • {phase}</p>
        </div>

        {/* Body Measurements */}
        <Card data-testid="card-measurements">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Ruler className="w-5 h-5 text-accent" />
              Body Measurements
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="weight">Weight (lbs) *</Label>
                <Input
                  id="weight"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={measurements.weightLbs}
                  onChange={(e) => setMeasurements((p) => ({ ...p, weightLbs: e.target.value }))}
                  className="h-12 text-lg"
                  required
                  data-testid="input-weight"
                />
              </div>
              <div>
                <Label htmlFor="waistRelaxed">Waist Relaxed (in)</Label>
                <Input
                  id="waistRelaxed"
                  type="number"
                  inputMode="decimal"
                  step="0.25"
                  value={measurements.waistRelaxed}
                  onChange={(e) => setMeasurements((p) => ({ ...p, waistRelaxed: e.target.value }))}
                  className="h-12 text-lg"
                  data-testid="input-waist-relaxed"
                />
              </div>
              <div>
                <Label htmlFor="waistVacuum">Waist Vacuum (in)</Label>
                <Input
                  id="waistVacuum"
                  type="number"
                  inputMode="decimal"
                  step="0.25"
                  value={measurements.waistVacuum}
                  onChange={(e) => setMeasurements((p) => ({ ...p, waistVacuum: e.target.value }))}
                  className="h-12 text-lg"
                  data-testid="input-waist-vacuum"
                />
              </div>
              <div>
                <Label htmlFor="chest">Chest (in)</Label>
                <Input
                  id="chest"
                  type="number"
                  inputMode="decimal"
                  step="0.25"
                  value={measurements.chest}
                  onChange={(e) => setMeasurements((p) => ({ ...p, chest: e.target.value }))}
                  className="h-12 text-lg"
                  data-testid="input-chest"
                />
              </div>
              <div>
                <Label htmlFor="armsLeft">Left Arm (in)</Label>
                <Input
                  id="armsLeft"
                  type="number"
                  inputMode="decimal"
                  step="0.125"
                  value={measurements.armsLeft}
                  onChange={(e) => setMeasurements((p) => ({ ...p, armsLeft: e.target.value }))}
                  className="h-12 text-lg"
                  data-testid="input-arms-left"
                />
              </div>
              <div>
                <Label htmlFor="armsRight">Right Arm (in)</Label>
                <Input
                  id="armsRight"
                  type="number"
                  inputMode="decimal"
                  step="0.125"
                  value={measurements.armsRight}
                  onChange={(e) => setMeasurements((p) => ({ ...p, armsRight: e.target.value }))}
                  className="h-12 text-lg"
                  data-testid="input-arms-right"
                />
              </div>
              <div>
                <Label htmlFor="shoulders">Shoulders (in)</Label>
                <Input
                  id="shoulders"
                  type="number"
                  inputMode="decimal"
                  step="0.25"
                  value={measurements.shoulders}
                  onChange={(e) => setMeasurements((p) => ({ ...p, shoulders: e.target.value }))}
                  className="h-12 text-lg"
                  data-testid="input-shoulders"
                />
              </div>
              <div className="flex items-center justify-center bg-card-alt rounded-md p-3">
                <div className="text-center">
                  <div className="text-2xl font-bold text-success">{swRatio?.toFixed(2) || "—"}</div>
                  <div className="text-xs text-muted-foreground">S:W Ratio</div>
                </div>
              </div>
              <div>
                <Label htmlFor="thighsLeft">Left Thigh (in)</Label>
                <Input
                  id="thighsLeft"
                  type="number"
                  inputMode="decimal"
                  step="0.25"
                  value={measurements.thighsLeft}
                  onChange={(e) => setMeasurements((p) => ({ ...p, thighsLeft: e.target.value }))}
                  className="h-12 text-lg"
                  data-testid="input-thighs-left"
                />
              </div>
              <div>
                <Label htmlFor="thighsRight">Right Thigh (in)</Label>
                <Input
                  id="thighsRight"
                  type="number"
                  inputMode="decimal"
                  step="0.25"
                  value={measurements.thighsRight}
                  onChange={(e) => setMeasurements((p) => ({ ...p, thighsRight: e.target.value }))}
                  className="h-12 text-lg"
                  data-testid="input-thighs-right"
                />
              </div>
              <div>
                <Label htmlFor="calvesLeft">Left Calf (in)</Label>
                <Input
                  id="calvesLeft"
                  type="number"
                  inputMode="decimal"
                  step="0.25"
                  value={measurements.calvesLeft}
                  onChange={(e) => setMeasurements((p) => ({ ...p, calvesLeft: e.target.value }))}
                  className="h-12 text-lg"
                  data-testid="input-calves-left"
                />
              </div>
              <div>
                <Label htmlFor="calvesRight">Right Calf (in)</Label>
                <Input
                  id="calvesRight"
                  type="number"
                  inputMode="decimal"
                  step="0.25"
                  value={measurements.calvesRight}
                  onChange={(e) => setMeasurements((p) => ({ ...p, calvesRight: e.target.value }))}
                  className="h-12 text-lg"
                  data-testid="input-calves-right"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Subjective Scores */}
        <Card data-testid="card-subjective">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-accent" />
              How Are You Feeling?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {[
              { key: "sleepQuality", label: "Sleep Quality" },
              { key: "energyLevels", label: "Energy Levels" },
              { key: "trainingMotivation", label: "Training Motivation" },
              { key: "hungerAppetite", label: "Hunger/Appetite" },
              { key: "mood", label: "Mood" },
            ].map(({ key, label }) => (
              <div key={key}>
                <div className="flex justify-between mb-2">
                  <Label>{label}</Label>
                  <span className="text-lg font-bold text-accent">
                    {subjective[key as keyof typeof subjective]}
                  </span>
                </div>
                <Slider
                  min={1}
                  max={10}
                  step={1}
                  value={[subjective[key as keyof typeof subjective]]}
                  onValueChange={([v]) => setSubjective((p) => ({ ...p, [key]: v }))}
                  className="py-2"
                  data-testid={`slider-${key}`}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1</span>
                  <span>10</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Progress Photos */}
        <Card data-testid="card-photos">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5 text-accent" />
              Progress Photos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {poseTypes.map(({ key, label }) => (
                <div key={key} className="relative">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    id={`photo-${key}`}
                    onChange={(e) => handlePhotoChange(key, e.target.files?.[0] || null)}
                    data-testid={`input-photo-${key}`}
                  />
                  <label
                    htmlFor={`photo-${key}`}
                    className="flex flex-col items-center justify-center aspect-[3/4] bg-card-alt rounded-md border-2 border-dashed border-border cursor-pointer hover:border-accent transition-colors"
                  >
                    {photos[key] ? (
                      <img
                        src={URL.createObjectURL(photos[key])}
                        alt={label}
                        className="w-full h-full object-cover rounded-md"
                      />
                    ) : (
                      <>
                        <Camera className="w-8 h-8 text-muted-foreground mb-2" />
                        <span className="text-xs text-muted-foreground text-center px-2">
                          {label}
                        </span>
                      </>
                    )}
                  </label>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Notes */}
        <Card data-testid="card-notes">
          <CardContent className="p-4">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Any additional notes about your week..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-2 resize-none min-h-[100px]"
              data-testid="input-notes"
            />
          </CardContent>
        </Card>

        {/* Submit Button */}
        <Button
          className="w-full h-14 text-lg"
          onClick={() => submitMutation.mutate()}
          disabled={submitMutation.isPending || !measurements.weightLbs}
          data-testid="button-submit-checkin"
        >
          {submitMutation.isPending ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              <CheckCircle2 className="w-5 h-5 mr-2" />
              Submit Check-In
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
