import { QueryClient, type QueryFunction } from "@tanstack/react-query";
import { sendOrQueue } from "./offlineQueue";

/**
 * Writes that are safe to replay after a connection drops.
 *
 * Each of these endpoints is idempotent on the server: completing a workout
 * replaces that day's sets, and a check-in updates that week's row. Deletes are
 * deliberately absent — replaying one after the record is already gone would
 * report a confusing failure, and nobody deletes a session mid-workout anyway.
 */
const QUEUEABLE_WRITES: Array<{ method: string; pattern: RegExp; label: string }> = [
  { method: "POST", pattern: /^\/api\/workouts\/complete$/, label: "Workout" },
  { method: "POST", pattern: /^\/api\/checkins$/, label: "Weekly check-in" },
  { method: "POST", pattern: /^\/api\/cardio$/, label: "Cardio session" },
  { method: "POST", pattern: /^\/api\/vacuum$/, label: "Vacuum session" },
];

function queueableLabel(method: string, url: string): string | null {
  const match = QUEUEABLE_WRITES.find((w) => w.method === method && w.pattern.test(url));
  return match?.label ?? null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function throwIfResNotOk(res: Response): Promise<void> {
  if (res.ok) return;

  // Prefer the server's `error` field over a raw body dump.
  let message = res.statusText;
  try {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text);
      message = parsed.error ?? parsed.message ?? text;
    } catch {
      message = text || res.statusText;
    }
  } catch {
    /* keep statusText */
  }
  throw new ApiError(res.status, message);
}

/** Status returned for a write held in the offline queue. */
export const QUEUED_STATUS = 202;

export function wasQueued(res: Response): boolean {
  return res.status === QUEUED_STATUS;
}

/**
 * Perform an API request.
 *
 * Queueable writes fall back to the offline store when the network is
 * unavailable and come back with a 202 rather than throwing, so a workout is
 * never lost to a dead spot in the gym.
 */
export async function apiRequest(method: string, url: string, data?: unknown): Promise<Response> {
  const label = queueableLabel(method, url);

  if (label && (method === "POST" || method === "PUT" || method === "PATCH")) {
    const { queued, response } = await sendOrQueue(method, url, data, label);
    if (queued) {
      return new Response(JSON.stringify({ queued: true }), {
        status: QUEUED_STATUS,
        headers: { "Content-Type": "application/json" },
      });
    }
    await throwIfResNotOk(response!);
    return response!;
  }

  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";

export const getQueryFn: <T>(options: { on401: UnauthorizedBehavior }) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/"), { credentials: "include" });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null as never;
    }

    await throwIfResNotOk(res);
    return res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      // Reconnecting after a gym dead spot should refresh what's on screen.
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      staleTime: 60_000,
      retry: (failureCount, error) => {
        // Never retry a rejection the server meant; do retry a flaky connection.
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
