import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Upload, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

/**
 * Restore training history from an exported CSV.
 *
 * The import began life as a command-line script, which is useless to someone
 * who uses this app as an installed PWA on a phone — a migration you cannot run
 * from the device you own is not a migration. This is the same code path,
 * reachable with a file picker.
 *
 * It always previews first. The preview is a real parse against the real
 * database that writes nothing, so the counts shown are the counts that will
 * happen — not an estimate.
 */

interface ImportReport {
  dryRun: boolean;
  sessions: number;
  sets: number;
  setsWithWeight: number;
  firstWeek: number | null;
  lastWeek: number | null;
  rowsRepaired: number;
  duplicatesCollapsed: number;
  clashes: number;
  clashesReplaced: number;
  retiredMovements: string[];
  skipped: Array<{ line: number; reason: string }>;
}

async function postCsv(csv: string, options: { dryRun: boolean; replace: boolean }) {
  const params = new URLSearchParams({
    dryRun: String(options.dryRun),
    replace: String(options.replace),
  });

  const res = await fetch(`/api/history/import?${params}`, {
    method: "POST",
    headers: { "Content-Type": "text/csv" },
    credentials: "include",
    body: csv,
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(body?.message ?? `Import failed (${res.status})`);
    (error as Error & { status?: number }).status = res.status;
    throw error;
  }
  return body as ImportReport;
}

export default function ImportHistory() {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  /** True once the server has told us these sessions already exist. */
  const [needsReplace, setNeedsReplace] = useState(false);

  const reset = () => {
    setCsv(null);
    setFileName("");
    setPreview(null);
    setNeedsReplace(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setPreview(null);
    setNeedsReplace(false);
    try {
      const text = await file.text();
      setCsv(text);
      setFileName(file.name);
      setPreview(await postCsv(text, { dryRun: true, replace: false }));
    } catch (err) {
      toast({ title: "Couldn't read that file", description: (err as Error).message, variant: "destructive" });
      reset();
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async (replace: boolean) => {
    if (!csv) return;
    setBusy(true);
    try {
      const report = await postCsv(csv, { dryRun: false, replace });
      // Every screen that shows history or a recommended weight is now stale.
      queryClient.invalidateQueries();
      toast({
        title: "History imported",
        description: `${report.sessions} sessions and ${report.sets} sets restored. Weight suggestions will show from your next session.`,
      });
      reset();
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 409) {
        setNeedsReplace(true);
        toast({
          title: "Some sessions already exist",
          description: (err as Error).message,
          variant: "destructive",
        });
      } else {
        toast({ title: "Import failed", description: (err as Error).message, variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="card-import-history">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="w-5 h-5 text-accent" />
          Import Training History
        </CardTitle>
        <CardDescription>
          Restore logged sessions from a workout history CSV — from this app or the old one. Weight
          suggestions come from your last session, so importing brings them back.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
          data-testid="input-import-file"
        />

        <Button
          onClick={() => fileInput.current?.click()}
          variant={preview ? "outline" : "default"}
          className="w-full"
          disabled={busy}
          data-testid="button-choose-history-file"
        >
          {busy && !preview ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Reading…
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              {preview ? "Choose a different file" : "Choose CSV file"}
            </>
          )}
        </Button>

        {preview && (
          <div className="space-y-3 rounded-md bg-card-alt p-3" data-testid="import-preview">
            <p className="text-sm font-medium truncate">{fileName}</p>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Sessions</dt>
              <dd className="text-right font-mono">{preview.sessions}</dd>

              <dt className="text-muted-foreground">Sets</dt>
              <dd className="text-right font-mono">{preview.sets}</dd>

              <dt className="text-muted-foreground">With a weight</dt>
              <dd className="text-right font-mono">{preview.setsWithWeight}</dd>

              {preview.firstWeek !== null && (
                <>
                  <dt className="text-muted-foreground">Weeks</dt>
                  <dd className="text-right font-mono">
                    {preview.firstWeek}–{preview.lastWeek}
                  </dd>
                </>
              )}
            </dl>

            {(preview.rowsRepaired > 0 ||
              preview.duplicatesCollapsed > 0 ||
              preview.retiredMovements.length > 0 ||
              preview.skipped.length > 0) && (
              <ul className="space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                {preview.rowsRepaired > 0 && (
                  <li>{preview.rowsRepaired} rows repaired — the exercise name contained a comma</li>
                )}
                {preview.duplicatesCollapsed > 0 && (
                  <li>{preview.duplicatesCollapsed} duplicate rows dropped — a session saved twice</li>
                )}
                {preview.retiredMovements.length > 0 && (
                  <li>
                    {preview.retiredMovements.length} movements no longer in the program, kept so
                    their sets survive: {preview.retiredMovements.join(", ")}
                  </li>
                )}
                {preview.skipped.length > 0 && (
                  <li className="text-destructive">
                    <AlertTriangle className="inline w-3 h-3 mr-1" />
                    {preview.skipped.length} lines could not be read and will be left out
                  </li>
                )}
              </ul>
            )}

            {preview.clashes > 0 && (
              <p className="flex gap-2 text-xs text-destructive">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {preview.clashes} of these sessions already exist. Importing will replace them.
              </p>
            )}

            {preview.sessions === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing in this file to import.</p>
            ) : (
              <Button
                onClick={() => void handleImport(needsReplace || preview.clashes > 0)}
                className="w-full"
                disabled={busy}
                variant={needsReplace || preview.clashes > 0 ? "destructive" : "default"}
                data-testid="button-confirm-import"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importing…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    {needsReplace || preview.clashes > 0
                      ? `Replace ${preview.clashes} and import ${preview.sessions} sessions`
                      : `Import ${preview.sessions} sessions`}
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
