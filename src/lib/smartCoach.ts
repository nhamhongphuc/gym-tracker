import { en } from "@/i18n/en";
import { formatTemplate, type Locale } from "@/i18n/LanguageContext";
import { vi } from "@/i18n/vi";
import type {
  Exercise,
  PlanExerciseWithDetails,
  SetLog,
  WorkoutSession,
} from "@/types/database";

export interface SmartSuggestion {
  suggestedWeightKg: number;
  suggestedReps: number;
  badge: string;
  headline: string;
  reason: string;
  isUpgrade: boolean;
}

export interface MuscleGroupSummary {
  muscleGroup: string;
  setsCount: number;
  volumeKg: number;
  intensity: number; // 0..1 relative to max worked group
  recoveryPercent: number; // 0..100 over 72h recovery curve
  statusLabel: "Fresh" | "Recovering" | "Fatigued";
  exercises: string[];
  lastTrainedAt: string | null;
}

const ANATOMY_GROUPS = [
  "Chest",
  "Back",
  "Shoulders",
  "Legs",
  "Arms",
  "Core",
] as const;

function parseTargetRepRange(targetReps: string): {
  minReps: number;
  maxReps: number;
} | null {
  const trimmed = targetReps.trim().toLowerCase();
  if (/[a-z]/.test(trimmed)) return null;

  const rangeMatch = trimmed.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1], 10);
    const max = parseInt(rangeMatch[2], 10);
    if (min > 0 && max >= min) return { minReps: min, maxReps: max };
  }

  const singleMatch = trimmed.match(/^(\d+)$/);
  if (singleMatch) {
    const val = parseInt(singleMatch[1], 10);
    if (val > 0) return { minReps: val, maxReps: val };
  }

  return null;
}

function roundWeightIncrement(
  weight: number,
  equipment: string
): { nextWeight: number; increment: number } {
  const eq = equipment.toLowerCase();
  const increment =
    eq.includes("dumbbell") || eq.includes("kettlebell") ? 2 : 2.5;
  const nextWeight = Math.round((weight + increment) * 10) / 10;
  return { nextWeight, increment };
}

/**
 * Smart Trainer progressive overload recommendation based on last completed session.
 */
export function computeSmartSuggestion(
  pe: PlanExerciseWithDetails,
  previousLogs: SetLog[],
  locale: Locale = "en"
): SmartSuggestion | null {
  if (previousLogs.length === 0) return null;

  const repRange = parseTargetRepRange(pe.target_reps);
  if (!repRange) return null;

  const completed = previousLogs.filter((l) => l.is_completed);
  if (completed.length === 0) return null;

  const working = completed.filter((l) => l.set_type === "working");
  const sample = working.length > 0 ? working : completed;

  const maxWeight = Math.max(...sample.map((s) => s.weight_kg));
  const topReps = Math.max(...sample.map((s) => s.reps));
  const avgReps =
    sample.reduce((sum, s) => sum + s.reps, 0) / Math.max(1, sample.length);
  const allHitTop = sample.every((s) => s.reps >= repRange.maxReps);

  const coach = locale === "vi" ? vi.smartCoach : en.smartCoach;

  if (allHitTop) {
    if (maxWeight > 0) {
      const { nextWeight, increment } = roundWeightIncrement(
        maxWeight,
        pe.exercise.equipment
      );
      return {
        suggestedWeightKg: nextWeight,
        suggestedReps: repRange.minReps,
        badge: `↑ +${increment}kg`,
        headline: formatTemplate(coach.tryWeight, {
          weight: nextWeight,
          reps: repRange.minReps,
        }),
        reason: formatTemplate(coach.reasonHitTop, { max: repRange.maxReps }),
        isUpgrade: true,
      };
    }

    const nextReps = repRange.maxReps + 2;
    return {
      suggestedWeightKg: 0,
      suggestedReps: nextReps,
      badge: `↑ ${formatTemplate(coach.badgeReps, { inc: 2 })}`,
      headline: formatTemplate(coach.tryReps, { reps: nextReps }),
      reason: formatTemplate(coach.reasonMastered, { max: repRange.maxReps }),
      isUpgrade: true,
    };
  }

  if (avgReps >= repRange.minReps) {
    const nextReps = Math.min(repRange.maxReps, topReps + 1);
    return {
      suggestedWeightKg: maxWeight,
      suggestedReps: nextReps,
      badge: `↑ ${coach.badgeRep}`,
      headline:
        maxWeight > 0
          ? formatTemplate(coach.aimWeight, {
              weight: maxWeight,
              reps: nextReps,
            })
          : formatTemplate(coach.aimReps, { reps: nextReps }),
      reason: coach.reasonBuildReps,
      isUpgrade: true,
    };
  }

  return {
    suggestedWeightKg: maxWeight,
    suggestedReps: repRange.minReps,
    badge: coach.badgeHold,
    headline:
      maxWeight > 0
        ? formatTemplate(coach.holdWeight, {
            weight: maxWeight,
            reps: repRange.minReps,
          })
        : formatTemplate(coach.holdReps, { reps: repRange.minReps }),
    reason: coach.reasonConsolidate,
    isUpgrade: false,
  };
}

/**
 * Aggregates last-30-day muscle group training volume, intensity & 72h recovery status.
 */
export function computeMuscleAnalytics(
  sessions: WorkoutSession[],
  nowMs: number = Date.now()
): Record<string, MuscleGroupSummary> {
  const cutoffMs = nowMs - 30 * 24 * 60 * 60 * 1000;

  const accum: Record<
    string,
    {
      setsCount: number;
      volumeKg: number;
      exerciseSet: Set<string>;
      latestTimestampMs: number | null;
      latestIso: string | null;
    }
  > = {};

  for (const group of ANATOMY_GROUPS) {
    accum[group] = {
      setsCount: 0,
      volumeKg: 0,
      exerciseSet: new Set<string>(),
      latestTimestampMs: null,
      latestIso: null,
    };
  }

  for (const session of sessions) {
    const sessionIso = session.completed_at ?? session.started_at;
    const sessionMs = new Date(sessionIso).getTime();
    if (Number.isNaN(sessionMs) || sessionMs < cutoffMs) continue;

    for (const log of session.set_logs ?? []) {
      if (!log.is_completed) continue;
      const group = log.exercise?.muscle_group;
      if (!group || !accum[group]) continue;

      accum[group].setsCount += 1;
      accum[group].volumeKg += log.weight_kg * log.reps;
      if (log.exercise?.name) {
        accum[group].exerciseSet.add(log.exercise.name);
      }

      if (
        accum[group].latestTimestampMs === null ||
        sessionMs > accum[group].latestTimestampMs
      ) {
        accum[group].latestTimestampMs = sessionMs;
        accum[group].latestIso = sessionIso;
      }
    }
  }

  const maxSets = Math.max(
    1,
    ...ANATOMY_GROUPS.map((g) => accum[g].setsCount)
  );

  const result: Record<string, MuscleGroupSummary> = {};
  const recoveryWindowHours = 72;

  for (const group of ANATOMY_GROUPS) {
    const entry = accum[group];
    const intensity =
      entry.setsCount > 0 ? Math.max(0.25, entry.setsCount / maxSets) : 0;

    let recoveryPercent = 100;
    if (entry.latestTimestampMs !== null) {
      const hoursSince = Math.max(
        0,
        (nowMs - entry.latestTimestampMs) / (1000 * 60 * 60)
      );
      recoveryPercent = Math.min(
        100,
        Math.round((hoursSince / recoveryWindowHours) * 100)
      );
    }

    const statusLabel: MuscleGroupSummary["statusLabel"] =
      recoveryPercent >= 85
        ? "Fresh"
        : recoveryPercent >= 45
          ? "Recovering"
          : "Fatigued";

    result[group] = {
      muscleGroup: group,
      setsCount: entry.setsCount,
      volumeKg: Math.round(entry.volumeKg),
      intensity,
      recoveryPercent,
      statusLabel,
      exercises: Array.from(entry.exerciseSet),
      lastTrainedAt: entry.latestIso,
    };
  }

  return result;
}

/**
 * Ranks same-muscle swap alternatives when a gym machine/station is occupied.
 */
export function rankSwapAlternatives(
  current: Exercise,
  catalog: Exercise[],
  excludeIds: Set<string>,
  limit = 12
): Exercise[] {
  const currentTargets = new Set(
    current.target_muscles.map((m) => m.toLowerCase())
  );
  const currentEq = current.equipment.toLowerCase();

  return catalog
    .filter(
      (ex) =>
        ex.id !== current.id &&
        !excludeIds.has(ex.id) &&
        ex.muscle_group === current.muscle_group
    )
    .map((ex) => {
      let score = 0;
      for (const target of ex.target_muscles) {
        if (currentTargets.has(target.toLowerCase())) score += 3;
      }
      if (ex.equipment.toLowerCase() !== currentEq) score += 2;
      if (ex.gif_url) score += 1;
      return { ex, score };
    })
    .sort((a, b) => b.score - a.score || a.ex.name.localeCompare(b.ex.name))
    .slice(0, limit)
    .map((item) => item.ex);
}
