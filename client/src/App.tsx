import { Suspense, lazy } from "react";
import { Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import BottomNav from "@/components/layout/BottomNav";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Dashboard from "@/pages/dashboard";
import Login from "@/pages/login";
import Register from "@/pages/register";
import Workout from "@/pages/workout";
import CheckIn from "@/pages/checkin";
import Progress from "@/pages/progress";
import History from "@/pages/history";
import Export from "@/pages/export";
import Settings from "@/pages/settings";
import Cardio from "@/pages/cardio";
import CardioHistory from "@/pages/cardio-history";
import Vacuum from "@/pages/vacuum";
import NotFound from "@/pages/not-found";
import type { PublicUser } from "@shared/schema";

/*
 * Charting pulls in recharts, roughly half the JavaScript in the app. Splitting
 * these two routes keeps it out of the initial download, which matters on a
 * phone opening the workout logger between sets.
 */
const CheckInHistory = lazy(() => import("@/pages/checkin-history"));
const VacuumHistory = lazy(() => import("@/pages/vacuum-history"));

function RouteFallback() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function AuthenticatedRoutes() {
  return (
    <>
      <Suspense fallback={<RouteFallback />}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/workout/:day" component={Workout} />
          <Route path="/checkin" component={CheckIn} />
          <Route path="/checkin/history" component={CheckInHistory} />
          <Route path="/cardio" component={Cardio} />
          <Route path="/cardio/history" component={CardioHistory} />
          <Route path="/vacuum" component={Vacuum} />
          <Route path="/vacuum/history" component={VacuumHistory} />
          <Route path="/progress" component={Progress} />
          <Route path="/history" component={History} />
          <Route path="/export" component={Export} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
      <BottomNav />
      <InstallPrompt />
    </>
  );
}

function UnauthenticatedRoutes() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route component={Login} />
    </Switch>
  );
}

function Router() {
  const { data: user, isLoading } = useQuery<PublicUser | null>({
    queryKey: ["/api/user"],
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
  }

  return user ? <AuthenticatedRoutes /> : <UnauthenticatedRoutes />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="dark">
          {/* Rendered above the router so queued work is visible on every screen. */}
          <OfflineBanner />
          <ErrorBoundary>
            <Router />
          </ErrorBoundary>
        </div>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
