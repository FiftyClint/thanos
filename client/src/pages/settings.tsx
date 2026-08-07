import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Settings as SettingsIcon, User, Calendar, Trophy } from "lucide-react";

const profileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  age: z.string().optional(),
  heightFeet: z.string().optional(),
  heightInches: z.string().optional(),
  showDate: z.string().optional(),
  prepStartDate: z.string().optional(),
  competitionName: z.string().optional(),
  division: z.string().optional(),
});

type ProfileForm = z.infer<typeof profileSchema>;

interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: string;
  age: number | null;
  heightInches: number | null;
  showDate: string | null;
  prepStartDate: string | null;
  competitionName: string | null;
  division: string | null;
}

export default function Settings() {
  const { toast } = useToast();

  const { data: user, isLoading } = useQuery<UserProfile>({
    queryKey: ["/api/user"],
  });

  const heightFeet = user?.heightInches ? Math.floor(user.heightInches / 12) : undefined;
  const heightInchesRemainder = user?.heightInches ? user.heightInches % 12 : undefined;

  const form = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    values: {
      name: user?.name || "",
      age: user?.age?.toString() || "",
      heightFeet: heightFeet?.toString() || "",
      heightInches: heightInchesRemainder?.toString() || "",
      showDate: user?.showDate ? new Date(user.showDate).toISOString().split("T")[0] : "",
      prepStartDate: user?.prepStartDate ? new Date(user.prepStartDate).toISOString().split("T")[0] : "",
      competitionName: user?.competitionName || "",
      division: user?.division || "",
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: ProfileForm) => {
      const feet = parseInt(data.heightFeet || "0") || 0;
      const inches = parseInt(data.heightInches || "0") || 0;
      const totalInches = feet * 12 + inches;
      const ageNum = data.age ? parseInt(data.age) : null;

      const payload = {
        name: data.name,
        age: ageNum && !isNaN(ageNum) ? ageNum : null,
        heightInches: totalInches > 0 ? totalInches : null,
        showDate: data.showDate || null,
        prepStartDate: data.prepStartDate || null,
        competitionName: data.competitionName || null,
        division: data.division || null,
      };

      const res = await apiRequest("PUT", "/api/user/profile", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({
        title: "Profile Updated",
        description: "Your settings have been saved.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ProfileForm) => {
    updateMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-2xl mx-auto space-y-4">
          <Skeleton className="h-12 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-24">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <SettingsIcon className="w-8 h-8 text-accent" />
          <h1 className="text-2xl font-bold" data-testid="text-settings-title">Settings</h1>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <User className="w-5 h-5 text-accent" />
                <CardTitle className="text-lg">Personal Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="text-sm text-muted-foreground">
                  Email: {user?.email}
                </div>

                <FormField
                  control={form.control}
                  name="age"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Age</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          inputMode="numeric"
                          placeholder="Enter age"
                          {...field} 
                          data-testid="input-age" 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="heightFeet"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Height (ft)</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            inputMode="numeric"
                            placeholder="Feet"
                            {...field} 
                            data-testid="input-height-feet" 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="heightInches"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Height (in)</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            inputMode="numeric"
                            placeholder="Inches"
                            {...field} 
                            data-testid="input-height-inches" 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <Trophy className="w-5 h-5 text-accent" />
                <CardTitle className="text-lg">Competition Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="competitionName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Competition Name</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="e.g., NPC Nationals"
                          {...field} 
                          data-testid="input-competition-name" 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="division"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Division</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""}>
                        <FormControl>
                          <SelectTrigger data-testid="select-division">
                            <SelectValue placeholder="Select division" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="mens_physique">Men's Physique</SelectItem>
                          <SelectItem value="classic_physique">Classic Physique</SelectItem>
                          <SelectItem value="bodybuilding">Bodybuilding</SelectItem>
                          <SelectItem value="figure">Figure</SelectItem>
                          <SelectItem value="bikini">Bikini</SelectItem>
                          <SelectItem value="wellness">Wellness</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <Calendar className="w-5 h-5 text-accent" />
                <CardTitle className="text-lg">Prep Timeline</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="prepStartDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prep Start Date</FormLabel>
                      <FormControl>
                        <Input 
                          type="date"
                          {...field} 
                          data-testid="input-prep-start" 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="showDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Show Date</FormLabel>
                      <FormControl>
                        <Input 
                          type="date"
                          {...field} 
                          data-testid="input-show-date" 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {form.watch("showDate") && form.watch("prepStartDate") && (
                  <div className="p-3 bg-card-alt rounded-md">
                    <div className="text-sm text-muted-foreground">
                      Prep Duration: {
                        Math.ceil(
                          (new Date(form.watch("showDate")!).getTime() - new Date(form.watch("prepStartDate")!).getTime()) 
                          / (1000 * 60 * 60 * 24 * 7)
                        )
                      } weeks
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Button
              type="submit"
              className="w-full h-12"
              disabled={updateMutation.isPending}
              data-testid="button-save-settings"
            >
              {updateMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
