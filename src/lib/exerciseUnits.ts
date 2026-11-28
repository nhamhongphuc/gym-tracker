import type { Exercise } from "@/types/database";

// shortcut: cardio distance (km) and duration (min) reuse weight_kg and reps, while speed_kmh and incline_pct use dedicated columns

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
