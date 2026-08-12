// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { collectSetsToSave, type SetData } from "@/pages/workout";

/**
 * Regression tests for what actually gets sent when a session is completed.
 *
 * The save used to send only sets whose checkbox had been ticked
 * (`sets.filter((s) => s.completed)`). Typing 35 × 16 into every row and then
 * hitting "Complete Workout" without tapping the checkboxes posted a workout
 * with ZERO sets — saved, green toast, nothing logged.
 *
 * That failure is self-reinforcing: no set logs means no history, no history
 * means the next session's weight box is empty again, so there is never
 * anything on screen to suggest the previous session went missing.
 *
 * The other half of the problem is the opposite error. The weight box is
 * PRE-FILLED from the recommendation, so "has a weight" cannot mean "the user
 * did this set" — that would invent history for every exercise skipped that
 * day. Reps, duration, band colour and cardio notes are never pre-filled, so
 * they are the honest signal of work performed.
 */

function sets(...items: Partial<SetData>[]): SetData[] {
  return items.map((item, i) => ({ setNumber: i + 1, completed: false, ...item }));
}

describe("collectSetsToSave", () => {
  it("saves ticked sets", () => {
    const data = new Map([["ex-1", sets({ weightLbs: 135, reps: 10, completed: true })]]);
    expect(collectSetsToSave(data)).toEqual([
      expect.objectContaining({ exerciseId: "ex-1", setNumber: 1, weightLbs: 135, reps: 10 }),
    ]);
  });

  it("saves a set with reps typed but the checkbox never tapped", () => {
    // The bug. Two sets logged by hand, neither ticked, both silently dropped.
    const data = new Map([
      [
        "ex-1",
        sets(
          { weightLbs: 35, reps: 16, recommendedWeight: undefined },
          { weightLbs: 35, reps: 14, recommendedWeight: undefined },
        ),
      ],
    ]);
    expect(collectSetsToSave(data)).toHaveLength(2);
  });

  it("does not invent sets from a pre-filled recommendation alone", () => {
    // Exercise skipped entirely: the weight is the server's suggestion, not
    // something performed. Saving it would fabricate a session.
    const data = new Map([
      ["ex-1", sets({ weightLbs: 135, recommendedWeight: 135 }, { weightLbs: 135, recommendedWeight: 135 })],
    ]);
    expect(collectSetsToSave(data)).toEqual([]);
  });

  it("saves a set whose weight was changed away from the recommendation", () => {
    const data = new Map([
      ["ex-1", sets({ weightLbs: 145, recommendedWeight: 135, weightSource: "user_edited" })],
    ]);
    expect(collectSetsToSave(data)).toHaveLength(1);
  });

  it("saves timed work by its duration", () => {
    const data = new Map([["ex-1", sets({ durationSecs: 45 })]]);
    expect(collectSetsToSave(data)).toHaveLength(1);
  });

  it("ignores a timer that was reset to zero", () => {
    const data = new Map([["ex-1", sets({ durationSecs: 0 })]]);
    expect(collectSetsToSave(data)).toEqual([]);
  });

  it("saves band work by its colour and cardio by its notes", () => {
    const data = new Map([
      ["ex-1", sets({ bandNote: "Red" })],
      ["ex-2", sets({ cardioNotes: "12 min incline" })],
    ]);
    expect(collectSetsToSave(data)).toHaveLength(2);
  });

  it("keeps only the sets that were actually done", () => {
    const data = new Map([
      ["ex-1", sets({ weightLbs: 35, reps: 16 }, { weightLbs: 35, reps: 15 }, { weightLbs: 35, recommendedWeight: 35 })],
    ]);
    const saved = collectSetsToSave(data);
    expect(saved.map((s) => s.reps)).toEqual([16, 15]);
  });

  it("keeps left and right apart on unilateral work", () => {
    const data = new Map([
      [
        "ex-1",
        [
          { setNumber: 1, side: "left", weightLbs: 30, reps: 16, completed: false },
          { setNumber: 1, side: "right", weightLbs: 35, reps: 14, completed: false },
        ] as SetData[],
      ],
    ]);
    expect(collectSetsToSave(data)).toEqual([
      expect.objectContaining({ side: "left", weightLbs: 30, reps: 16 }),
      expect.objectContaining({ side: "right", weightLbs: 35, reps: 14 }),
    ]);
  });

  it("sends no client-only bookkeeping to the server", () => {
    // recommendedWeight/weightSource are UI state; the server's zod schema
    // strips them, but sending them invites drift between the two shapes.
    const data = new Map([
      ["ex-1", sets({ weightLbs: 135, reps: 8, completed: true, recommendedWeight: 130, weightSource: "user_edited" })],
    ]);
    const [saved] = collectSetsToSave(data);
    expect(saved).not.toHaveProperty("recommendedWeight");
    expect(saved).not.toHaveProperty("weightSource");
    expect(saved).not.toHaveProperty("completed");
  });

  it("reports nothing to save for an untouched day", () => {
    const data = new Map([
      ["ex-1", sets({ weightLbs: 135, recommendedWeight: 135 })],
      ["ex-2", sets({})],
    ]);
    expect(collectSetsToSave(data)).toEqual([]);
  });
});
