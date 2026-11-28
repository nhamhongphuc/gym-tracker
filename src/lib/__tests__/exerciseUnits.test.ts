import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampNumber,
  filterExerciseList,
  formatSetSummary,
  isCardioExercise,
  sanitizeDecimalInput,
} from "../exerciseUnits";
import { rankSwapAlternatives } from "../smartCoach";
import type { Exercise } from "../../types/database";

function makeEx(
  id: string,
  name: string,
  muscle_group: Exercise["muscle_group"],
  equipment = "Machine",
  target_muscles: string[] = []
): Exercise {
  return {
    id,
    external_id: null,
    source_name: "FreeExerciseDB",
    name,
    muscle_group,
    target_muscles,
    secondary_muscles: [],
    equipment,
    instructions: [],
    instructions_vi: [],
    tips: null,
    gif_url: null,
    image_urls: [],
    video_url: null,
  };
}

describe("exerciseUnits", () => {
  it("classifies walking/cardio separately from strength walks", () => {
    assert.equal(
      isCardioExercise({ name: "Walking, Treadmill", muscle_group: "Legs" }),
      true
    );
    assert.equal(
      isCardioExercise({ name: "Trail Running/Walking", muscle_group: "Legs" }),
      true
    );
    assert.equal(
      isCardioExercise({ name: "My Walk", muscle_group: "Cardio" }),
      true
    );
    assert.equal(
      isCardioExercise({ name: "Barbell Walking Lunge", muscle_group: "Legs" }),
      false
    );
    assert.equal(
      isCardioExercise({ name: "Farmer's Walk", muscle_group: "Arms" }),
      false
    );
    assert.equal(
      isCardioExercise({ name: "Monster Walk", muscle_group: "Legs" }),
      false
    );
  });

  it("formats strength and cardio summaries accurately", () => {
    assert.equal(formatSetSummary(60, 10, false, 5, 8), "60kg × 10");
    assert.equal(formatSetSummary(0, 37, true, 4, 4), "37m • 4km/h • 4%");
    assert.equal(
      formatSetSummary(2.5, 30, true, 5.5, 10),
      "2.5km • 30m • 5.5km/h • 10%"
    );
    assert.equal(formatSetSummary(0, 0, true, null, null), "0km • 0m");
  });

  it("sanitizes duplicate decimal points and clamps bounds", () => {
    assert.equal(sanitizeDecimalInput("5,5.2"), "5.52");
    assert.equal(sanitizeDecimalInput("12abc.3"), "12.3");
    assert.equal(clampNumber(65, 0, 50), 50);
    assert.equal(clampNumber(-5, 0, 50), 0);
    assert.equal(clampNumber(null, 0, 50), null);
  });

  it("filters exercises consistently across Cardio, equipment, and query", () => {
    const list = [
      makeEx("1", "Walking, Treadmill", "Legs", "Machine"),
      makeEx("2", "Barbell Squat", "Legs", "Barbell", ["quadriceps"]),
      makeEx("3", "Barbell Walking Lunge", "Legs", "Barbell"),
    ];
    assert.deepEqual(
      filterExerciseList(list, "", "Cardio", "All").map((x) => x.id),
      ["1"]
    );
    assert.deepEqual(
      filterExerciseList(list, "quad", "Legs", "Barbell").map((x) => x.id),
      ["2"]
    );
  });
});

describe("rankSwapAlternatives", () => {
  it("matches cardio to cardio and excludes cardio from strength leg swaps", () => {
    const walk = makeEx("w", "Walking, Treadmill", "Legs", "Machine");
    const bike = makeEx("b", "Bicycling, Stationary", "Legs", "Machine");
    const squat = makeEx("s", "Barbell Squat", "Legs", "Barbell");
    const legPress = makeEx("lp", "Leg Press", "Legs", "Machine");
    const catalog = [walk, bike, squat, legPress];

    assert.deepEqual(
      rankSwapAlternatives(walk, catalog, new Set()).map((x) => x.id),
      ["b"]
    );
    assert.deepEqual(
      rankSwapAlternatives(squat, catalog, new Set()).map((x) => x.id),
      ["lp"]
    );
  });
});
