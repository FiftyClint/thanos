import { get, set, del } from "idb-keyval";

/**
 * Offline write queue.
 *
 * Gyms are basements. The old app posted a finished workout straight to the
 * server and showed an error toast if the request failed — an hour of logging
 * lost to a dead bar of signal, with no way to get it back.
 *
 * Writes now go into IndexedDB first and are replayed when the connection
 * returns, so a session survives the phone being offline, the tab being closed,
 * or the app being killed mid-save.
 */

const QUEUE_KEY = "thanos:pending-writes";

export interface PendingWrite {
  id: string;
  method: "POST" | "PUT" | "PATCH";
  url: string;
  body: unknown;
  /** Human label used in the "N sessions waiting to sync" banner. */
  label: string;
  queuedAt: number;
  attempts: number;
}

type Listener = (queue: PendingWrite[]) => void;

const listeners = new Set<Listener>();

async function readQueue(): Promise<PendingWrite[]> {
  return (await get<PendingWrite[]>(QUEUE_KEY)) ?? [];
}

async function writeQueue(queue: PendingWrite[]): Promise<void> {
  if (queue.length === 0) await del(QUEUE_KEY);
  else await set(QUEUE_KEY, queue);
  for (const listener of listeners) listener(queue);
}

export function subscribeToQueue(listener: Listener): () => void {
  listeners.add(listener);
  void readQueue().then(listener);
  return () => listeners.delete(listener);
}

export async function getQueue(): Promise<PendingWrite[]> {
  return readQueue();
}

export async function enqueue(write: Omit<PendingWrite, "id" | "queuedAt" | "attempts">): Promise<void> {
  const queue = await readQueue();
  queue.push({
    ...write,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: Date.now(),
    attempts: 0,
  });
  await writeQueue(queue);
}

export async function clearQueue(): Promise<void> {
  await writeQueue([]);
}

/** A network failure, as opposed to the server answering with an error. */
function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

export interface FlushResult {
  sent: number;
  failed: number;
  remaining: number;
}

let flushing = false;

/**
 * Replay queued writes oldest-first.
 *
 * The endpoints this queue targets are idempotent by design — completing a
 * workout replaces that day's sets, and a check-in updates the week's row —
 * so a replay after an uncertain failure cannot double-log a session.
 *
 * A 4xx means the server understood and refused; retrying would never help, so
 * the item is dropped. Anything else (offline, 5xx) is kept for the next round.
 */
export async function flushQueue(): Promise<FlushResult> {
  if (flushing) return { sent: 0, failed: 0, remaining: (await readQueue()).length };
  flushing = true;

  try {
    const queue = await readQueue();
    const remaining: PendingWrite[] = [];
    let sent = 0;
    let failed = 0;

    for (const item of queue) {
      try {
        const res = await fetch(item.url, {
          method: item.method,
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(item.body),
        });

        if (res.ok) {
          sent++;
        } else if (res.status >= 400 && res.status < 500) {
          // Rejected on its merits — keeping it would retry forever.
          console.warn(`[offline] dropping "${item.label}": server returned ${res.status}`);
          failed++;
        } else {
          remaining.push({ ...item, attempts: item.attempts + 1 });
        }
      } catch (err) {
        if (!isNetworkError(err)) console.warn(`[offline] "${item.label}" failed`, err);
        remaining.push({ ...item, attempts: item.attempts + 1 });
        // Still offline; stop rather than hammering every queued item.
        break;
      }
    }

    await writeQueue(remaining);
    return { sent, failed, remaining: remaining.length };
  } finally {
    flushing = false;
  }
}

/**
 * POST/PUT with an offline fallback.
 *
 * Returns `{ queued: true }` when the request could not leave the device, so
 * the caller can tell the user their work is saved and waiting rather than lost.
 */
export async function sendOrQueue(
  method: PendingWrite["method"],
  url: string,
  body: unknown,
  label: string,
): Promise<{ queued: boolean; response?: Response }> {
  if (!navigator.onLine) {
    await enqueue({ method, url, body, label });
    return { queued: true };
  }

  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });

    // A 5xx might be a restart mid-deploy; hold it and try again.
    if (response.status >= 500) {
      await enqueue({ method, url, body, label });
      return { queued: true };
    }
    return { queued: false, response };
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    await enqueue({ method, url, body, label });
    return { queued: true };
  }
}

/** Flush on reconnect and when the app is brought back to the foreground. */
export function startAutoFlush(onFlushed?: (result: FlushResult) => void): () => void {
  const attempt = async () => {
    if (!navigator.onLine) return;
    const result = await flushQueue();
    if (result.sent > 0 || result.failed > 0) onFlushed?.(result);
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") void attempt();
  };

  window.addEventListener("online", attempt);
  document.addEventListener("visibilitychange", onVisible);
  void attempt();

  return () => {
    window.removeEventListener("online", attempt);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
