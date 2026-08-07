import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { subscribeToQueue, startAutoFlush, flushQueue, type PendingWrite } from "@/lib/offlineQueue";

/**
 * Tells the user what the offline queue is holding.
 *
 * Without this the queue would be invisible — the point is that a saved workout
 * is never silently in limbo.
 */
export function OfflineBanner() {
  const { toast } = useToast();
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState<PendingWrite[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => subscribeToQueue(setPending), []);

  useEffect(
    () =>
      startAutoFlush((result) => {
        // Fresh server data now that the queue has drained.
        void queryClient.invalidateQueries();
        if (result.sent > 0) {
          toast({
            title: "Synced",
            description: `${result.sent} saved ${result.sent === 1 ? "entry" : "entries"} uploaded.`,
          });
        }
        if (result.failed > 0) {
          toast({
            title: "Some entries were rejected",
            description: `${result.failed} could not be saved. Check the affected day and re-enter it.`,
            variant: "destructive",
          });
        }
      }),
    [toast],
  );

  const handleRetry = async () => {
    setSyncing(true);
    try {
      const result = await flushQueue();
      void queryClient.invalidateQueries();
      if (result.remaining > 0) {
        toast({ title: "Still offline", description: "Your entries are saved and will upload automatically." });
      }
    } finally {
      setSyncing(false);
    }
  };

  if (online && pending.length === 0) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 bg-warning/15 border-b border-warning/40 backdrop-blur"
      data-testid="banner-offline"
      role="status"
    >
      <div className="max-w-4xl mx-auto flex items-center gap-2 px-4 py-2 text-sm">
        {online ? (
          <CheckCircle2 className="w-4 h-4 text-warning shrink-0" />
        ) : (
          <CloudOff className="w-4 h-4 text-warning shrink-0" />
        )}

        <span className="flex-1 text-foreground">
          {pending.length > 0 ? (
            <>
              <strong>{pending.length}</strong> {pending.length === 1 ? "entry is" : "entries are"} saved on this
              device{online ? " and uploading…" : " — they'll upload when you're back online."}
            </>
          ) : (
            "Offline — your training will be saved on this device."
          )}
        </span>

        {pending.length > 0 && online && (
          <button
            onClick={handleRetry}
            disabled={syncing}
            className="flex items-center gap-1 text-xs font-medium text-warning hover:text-foreground disabled:opacity-50"
            data-testid="button-retry-sync"
          >
            <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
