import { Link, useLocation } from "wouter";
import { Home, Dumbbell, Activity, Wind, ClipboardCheck, TrendingUp, Download } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/workout/1", icon: Dumbbell, label: "Workout" },
  { href: "/cardio", icon: Activity, label: "Cardio" },
  { href: "/vacuum", icon: Wind, label: "Vacuum" },
  { href: "/checkin", icon: ClipboardCheck, label: "Check-In" },
  { href: "/progress", icon: TrendingUp, label: "Progress" },
  { href: "/export", icon: Download, label: "Export" },
];

export default function BottomNav() {
  const [location] = useLocation();

  const isActive = (href: string) => {
    if (href === "/") return location === "/";
    return location.startsWith(href.split("/")[1] ? `/${href.split("/")[1]}` : href);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border" data-testid="nav-bottom">
      <div className="max-w-4xl mx-auto flex items-center justify-around h-16">
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link key={item.href} href={item.href}>
              <button
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-md transition-colors min-w-[48px]",
                  active
                    ? "text-accent"
                    : "text-muted-foreground hover:text-foreground"
                )}
                data-testid={`nav-${item.label.toLowerCase().replace("-", "")}`}
              >
                <item.icon className="w-4 h-4" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
