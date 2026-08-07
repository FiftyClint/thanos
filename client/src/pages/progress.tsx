import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Image, Grid, Columns, Dumbbell, TrendingUp } from "lucide-react";
import type { ProgressPhoto } from "@shared/schema";

const poseLabels: Record<string, string> = {
  front_relaxed: "Front Relaxed",
  front_double_bicep: "Front Double Bicep",
  side_chest_left: "Side Chest Left",
  side_chest_right: "Side Chest Right",
  rear_lat_spread: "Rear Lat Spread",
  rear_double_bicep: "Rear Double Bicep",
  other: "Other",
};

export default function Progress() {
  const [filterPose, setFilterPose] = useState<string>("all");
  const [compareMode, setCompareMode] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);

  const { data: photos, isLoading } = useQuery<ProgressPhoto[]>({
    queryKey: ["/api/photos"],
  });

  const filteredPhotos = photos?.filter(
    (p) => filterPose === "all" || p.poseType === filterPose
  );

  const photosByWeek = filteredPhotos?.reduce((acc, photo) => {
    const week = photo.week;
    if (!acc[week]) acc[week] = [];
    acc[week].push(photo);
    return acc;
  }, {} as Record<number, ProgressPhoto[]>);

  const weeks = photosByWeek ? Object.keys(photosByWeek).map(Number).sort((a, b) => b - a) : [];

  const handlePhotoSelect = (id: string) => {
    if (!compareMode) return;
    
    setSelectedPhotos((prev) => {
      if (prev.includes(id)) {
        return prev.filter((p) => p !== id);
      }
      if (prev.length >= 2) {
        return [prev[1], id];
      }
      return [...prev, id];
    });
  };

  const getSelectedPhotoData = () => {
    if (!photos) return [];
    return selectedPhotos.map((id) => photos.find((p) => p.id === id)).filter(Boolean);
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="max-w-4xl mx-auto p-4 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-bold text-accent flex items-center gap-2" data-testid="progress-title">
            <Image className="w-6 h-6" />
            Progress Photos
          </h1>
          
          <div className="flex items-center gap-2">
            <Link href="/checkin/history">
              <Button variant="outline" size="sm" data-testid="link-measurement-charts">
                <TrendingUp className="w-4 h-4 mr-1" />
                Measurement Charts
              </Button>
            </Link>
            <Link href="/history">
              <Button variant="outline" size="sm" data-testid="link-workout-history">
                <Dumbbell className="w-4 h-4 mr-1" />
                Workout History
              </Button>
            </Link>
          </div>
        </div>
        
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Select value={filterPose} onValueChange={setFilterPose}>
              <SelectTrigger className="w-[180px]" data-testid="select-pose-filter">
                <SelectValue placeholder="Filter by pose" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Poses</SelectItem>
                {Object.entries(poseLabels).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <button
              onClick={() => {
                setCompareMode(!compareMode);
                setSelectedPhotos([]);
              }}
              className={`p-2 rounded-md transition-colors ${
                compareMode ? "bg-accent text-white" : "bg-card hover:bg-card-alt"
              }`}
              data-testid="button-compare-mode"
            >
              <Columns className="w-5 h-5" />
            </button>
          </div>
        </div>

        {compareMode && (
          <Card className="border-accent/50">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground mb-3">
                Select 2 photos to compare side by side
              </div>
              {selectedPhotos.length === 2 && (
                <Dialog>
                  <DialogTrigger asChild>
                    <button
                      className="w-full bg-accent text-white rounded-md py-2 font-medium hover:bg-accent/90"
                      data-testid="button-view-comparison"
                    >
                      View Comparison
                    </button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl">
                    <div className="grid grid-cols-2 gap-4">
                      {getSelectedPhotoData().map((photo) => (
                        <div key={photo!.id} className="space-y-2">
                          <img
                            src={photo!.filePath.startsWith("/objects/") ? photo!.filePath : `/uploads/${photo!.filePath}`}
                            alt={poseLabels[photo!.poseType]}
                            className="w-full rounded-md"
                          />
                          <div className="text-center">
                            <Badge variant="secondary">Week {photo!.week}</Badge>
                            <div className="text-sm text-muted-foreground mt-1">
                              {poseLabels[photo!.poseType]}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="aspect-[3/4]" />
            ))}
          </div>
        ) : weeks.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Image className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No progress photos yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Photos will appear here after your weekly check-ins
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {weeks.map((week) => (
              <div key={week}>
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Badge className="bg-primary text-primary-foreground">Week {week}</Badge>
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {photosByWeek![week].map((photo) => {
                    const isSelected = selectedPhotos.includes(photo.id);
                    
                    return (
                      <Dialog key={photo.id}>
                        <DialogTrigger asChild>
                          <div
                            className={`relative cursor-pointer rounded-md overflow-hidden group ${
                              compareMode && isSelected
                                ? "ring-2 ring-accent"
                                : ""
                            }`}
                            onClick={(e) => {
                              if (compareMode) {
                                e.preventDefault();
                                handlePhotoSelect(photo.id);
                              }
                            }}
                            data-testid={`photo-${photo.id}`}
                          >
                            <img
                              src={photo.filePath.startsWith("/objects/") ? photo.filePath : `/uploads/${photo.filePath}`}
                              alt={poseLabels[photo.poseType]}
                              className="w-full aspect-[3/4] object-cover transition-transform group-hover:scale-105"
                            />
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                              <div className="text-xs text-white/90">
                                {poseLabels[photo.poseType]}
                              </div>
                            </div>
                            {compareMode && isSelected && (
                              <div className="absolute top-2 right-2 w-6 h-6 bg-accent rounded-full flex items-center justify-center text-white text-sm font-bold">
                                {selectedPhotos.indexOf(photo.id) + 1}
                              </div>
                            )}
                          </div>
                        </DialogTrigger>
                        {!compareMode && (
                          <DialogContent className="max-w-2xl">
                            <img
                              src={photo.filePath.startsWith("/objects/") ? photo.filePath : `/uploads/${photo.filePath}`}
                              alt={poseLabels[photo.poseType]}
                              className="w-full rounded-md"
                            />
                            <div className="text-center mt-2">
                              <Badge variant="secondary">Week {photo.week}</Badge>
                              <div className="text-sm text-muted-foreground mt-1">
                                {poseLabels[photo.poseType]}
                              </div>
                            </div>
                          </DialogContent>
                        )}
                      </Dialog>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
