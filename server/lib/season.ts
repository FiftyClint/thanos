import { seasonOf } from "@shared/seasons";
import { storage } from "../storage";

/**
 * The athlete's active program and the season its weeks belong to.
 *
 * The season is derived on the server from the program, never taken from the
 * request: a stale client that sent the wrong season would otherwise file a
 * session under another cycle's week.
 */
export async function activeSeason(userId: string): Promise<{ program: string; season: number }> {
  const user = await storage.getUser(userId);
  const program = user?.activeProgram ?? "phase3";
  return { program, season: seasonOf(program) };
}
