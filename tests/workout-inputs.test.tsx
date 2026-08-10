// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderSetInputs, type SetData } from "@/pages/workout";
import type { Exercise } from "@shared/schema";

/**
 * Regression tests for the set-entry inputs.
 *
 * These exist because unilateral exercises could not be typed into at all: the
 * row component was declared inside a .map() callback, so every keystroke gave
 * React a new component type, which unmounts and remounts the subtree instead
 * of updating it. The focused <input> was destroyed on each character, taking
 * focus and the on-screen keyboard with it.
 *
 * Nothing else in the suite would have caught this — it is invisible to
 * typecheck, lint, and any test that doesn't actually render and type.
 */

// Vitest is not running with globals, so Testing Library's automatic cleanup
// is never registered — without this the DOM accumulates across tests and
// queries start matching detached nodes from earlier renders.
afterEach(cleanup);

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: "ex-1",
    day: 1,
    order: 2,
    number: "2",
    name: "Single-Arm Behind-Body Cable Lateral Raise",
    defaultSets: 4,
    repRange: "12-20",
    tempo: "2-0-1-1",
    rir: "1-2",
    restSeconds: "75s",
    notes: "",
    alternate: "",
    videoUrl: "",
    inputType: "weight_reps_unilateral",
    isSupersetPart: false,
    supersetGroup: null,
    segment: "working",
    program: "phase3",
    ...overrides,
  } as Exercise;
}

function unilateralSets(count = 2): SetData[] {
  return Array.from({ length: count }, (_, i) => i + 1).flatMap((setNumber) => [
    { setNumber, side: "left", completed: false },
    { setNumber, side: "right", completed: false },
  ]);
}

/**
 * Renders the inputs with real state, the way the workout page does — so a
 * keystroke triggers a re-render, which is precisely what broke.
 */
function Harness({ ex, initial }: { ex: Exercise; initial: SetData[] }) {
  const [sets, setSets] = useState<SetData[]>(initial);

  const updateSet = (_exerciseId: string, setIndex: number, field: keyof SetData, value: unknown) => {
    setSets((prev) => {
      const next = [...prev];
      if (!next[setIndex]) return prev;
      next[setIndex] = { ...next[setIndex], [field]: value };
      return next;
    });
  };

  return <>{renderSetInputs(ex, sets, updateSet, vi.fn())}</>;
}

describe("unilateral set entry", () => {
  it("keeps focus while typing a weight", async () => {
    const user = userEvent.setup();
    render(<Harness ex={exercise()} initial={unilateralSets()} />);

    const weightInputs = screen.getAllByPlaceholderText("Lbs");
    const first = weightInputs[0];

    await user.click(first);
    expect(first).toHaveFocus();

    await user.keyboard("3");
    // The bug: the input is destroyed and rebuilt on the state update, so
    // focus lands back on <body> and the keyboard closes mid-set.
    expect(document.activeElement).toBe(first);
  });

  it("accepts a multi-digit weight", async () => {
    const user = userEvent.setup();
    render(<Harness ex={exercise()} initial={unilateralSets()} />);

    const first = screen.getAllByPlaceholderText("Lbs")[0] as HTMLInputElement;
    await user.click(first);
    await user.keyboard("35");

    // With the remount bug only the first digit ever lands, because the second
    // keystroke goes to an element that is no longer in the document.
    expect(first).toHaveValue(35);
  });

  it("records left and right independently", async () => {
    const user = userEvent.setup();
    render(<Harness ex={exercise()} initial={unilateralSets(1)} />);

    const weights = screen.getAllByPlaceholderText("Lbs") as HTMLInputElement[];
    expect(weights).toHaveLength(2); // one set → L and R

    await user.click(weights[0]);
    await user.keyboard("30");
    await user.click(weights[1]);
    await user.keyboard("35");

    expect(weights[0]).toHaveValue(30);
    expect(weights[1]).toHaveValue(35);
  });

  it("accepts reps as well as weight", async () => {
    const user = userEvent.setup();
    render(<Harness ex={exercise()} initial={unilateralSets(1)} />);

    // Reps carry the recommendation as placeholder text, hence "Reps" when absent.
    const reps = screen.getAllByPlaceholderText("Reps")[0] as HTMLInputElement;
    await user.click(reps);
    await user.keyboard("16");
    expect(reps).toHaveValue(16);
  });

  it("does not crash when a side is missing", async () => {
    // findIndex returns -1 for the absent side; updateSet then indexes sets[-1].
    const user = userEvent.setup();
    const lopsided: SetData[] = [{ setNumber: 1, side: "left", completed: false }];
    render(<Harness ex={exercise()} initial={lopsided} />);

    const weights = screen.getAllByPlaceholderText("Lbs") as HTMLInputElement[];
    await user.click(weights[0]);
    await user.keyboard("30");
    expect(weights[0]).toHaveValue(30);
  });
});

describe("bilateral set entry", () => {
  it("keeps focus while typing — the path that already worked", async () => {
    const user = userEvent.setup();
    const bilateral: SetData[] = [
      { setNumber: 1, completed: false },
      { setNumber: 2, completed: false },
    ];
    render(<Harness ex={exercise({ inputType: "weight_reps" })} initial={bilateral} />);

    const first = screen.getAllByPlaceholderText("Lbs")[0] as HTMLInputElement;
    await user.click(first);
    await user.keyboard("135");

    expect(first).toHaveValue(135);
    expect(document.activeElement).toBe(first);
  });
});
