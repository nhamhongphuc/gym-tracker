import type { Exercise } from "@/types/database";

// shortcut: cardio distance (km) and duration (min) reuse weight_kg and reps, while speed_kmh and incline_pct use dedicated columns

export const MUSCLE_FILTERS = [
  "All",
  "Chest",
  "Back",
  "Shoulders",
  "Legs",
  "Arms",
  "Core",
  "Cardio",
] as const;

export const EQUIPMENT_FILTERS = [
  "All",
  "Barbell",
  "Dumbbell",
  "Cable",
  "Machine",
  "Body",
  "Kettlebell",
] as const;

const STRENGTH_WALK_RE =
  /\b(lunge|farmer|monster|sled|yoke|crab|bear|duck|waiter|suitcase|hand\s*walk|wall\s*walk)\b/i;

const CARDIO_NAME_RE =
  /\b(treadmill|bicycling|cycling|stationary bike|recumbent bike|elliptical|stairmaster|stepmill|rowing,\s*stationary|jogging|running|skating|rope jumping|jump rope|swimming|hiking|sprint|walk(ing)?)\b/i;

export function isCardioExercise(
  exercise?: Pick<Exercise, "name" | "muscle_group"> | null
): boolean {
  if (!exercise) return false;
  if (exercise.muscle_group === "Cardio") return true;
  if (STRENGTH_WALK_RE.test(exercise.name)) return false;
  return CARDIO_NAME_RE.test(exercise.name);
}

export function formatSetSummary(
  weightOrKm: number,
  repsOrMin: number,
  isCardio: boolean,
  speedKmh?: number | null,
  inclinePct?: number | null
): string {
  if (!isCardio) return `${weightOrKm}kg × ${repsOrMin}`;
  const parts: string[] = [];
  if (weightOrKm > 0) parts.push(`${weightOrKm}km`);
  if (repsOrMin > 0) parts.push(`${repsOrMin}m`);
  if (speedKmh != null && speedKmh > 0) parts.push(`${speedKmh}km/h`);
  if (inclinePct != null && inclinePct > 0) parts.push(`${inclinePct}%`);
  return parts.length > 0 ? parts.join(" • ") : "0km • 0m";
}

export function sanitizeDecimalInput(raw: string): string {
  const clean = raw.replace(",", ".").replace(/[^0-9.]/g, "");
  const parts = clean.split(".");
  return parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : clean;
}

export function clampNumber(
  value: number | null,
  min: number,
  max: number
): number | null {
  return value == null ? null : Math.min(max, Math.max(min, value));
}

export function filterExerciseList(
  exercises: Exercise[],
  search: string,
  selectedMuscle: string,
  selectedEquipment: string
): Exercise[] {
  const query = search.trim().toLowerCase();
  const eqFilter = selectedEquipment.toLowerCase();

  return exercises.filter((ex) => {
    if (selectedMuscle === "Cardio") {
      if (!isCardioExercise(ex)) return false;
    } else if (selectedMuscle !== "All" && ex.muscle_group !== selectedMuscle) {
      return false;
    }
    if (
      selectedEquipment !== "All" &&
      !ex.equipment.toLowerCase().includes(eqFilter)
    ) {
      return false;
    }
    if (!query) return true;
    return (
      ex.name.toLowerCase().includes(query) ||
      ex.equipment.toLowerCase().includes(query) ||
      ex.muscle_group.toLowerCase().includes(query) ||
      ex.target_muscles.some((m) => m.toLowerCase().includes(query))
    );
  });
}
