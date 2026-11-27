import type {
  Exercise,
  ProgramDateOverride,
  ProgramScheduleState,
  ScheduleMode,
  WorkoutPlan,
  WorkoutProgram,
} from "@/types/database";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parses YYYY-MM-DD at local noon to avoid DST/UTC midnight boundary shifts.
 */
export function parseLocalNoon(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map((part) => parseInt(part, 10));
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function formatLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysToDateString(dateStr: string, deltaDays: number): string {
  const d = parseLocalNoon(dateStr);
  d.setDate(d.getDate() + deltaDays);
  return formatLocalDateString(d);
}

export function diffCalendarDays(fromDateStr: string, toDateStr: string): number {
  const fromMs = parseLocalNoon(fromDateStr).getTime();
  const toMs = parseLocalNoon(toDateStr).getTime();
  return Math.round((toMs - fromMs) / ONE_DAY_MS);
}

export function getIsoWeekdayForDateString(dateStr: string): number {
  const jsDay = parseLocalNoon(dateStr).getDay();
  return ((jsDay + 6) % 7) + 1; // 1 (Mon) .. 7 (Sun)
}

export function getMondayOfDateString(dateStr: string): string {
  const isoDay = getIsoWeekdayForDateString(dateStr);
  return addDaysToDateString(dateStr, -(isoDay - 1));
}

export function getWeekDaysFromMonday(mondayStr: string): {
  dateStr: string;
  dayOfWeek: number;
  dayOfMonth: number;
  monthShort: number;
}[] {
  return Array.from({ length: 7 }, (_, idx) => {
    const dateStr = addDaysToDateString(mondayStr, idx);
    const parsed = parseLocalNoon(dateStr);
    return {
      dateStr,
      dayOfWeek: idx + 1,
      dayOfMonth: parsed.getDate(),
      monthShort: parsed.getMonth() + 1,
    };
  });
}

export function resolvePlanForDate(
  program: WorkoutProgram,
  dateStr: string,
  todayDateStr: string
): {
  plan: WorkoutPlan | null;
  isRest: boolean;
  isSingleOverride: boolean;
} {
  const plans = program.workout_plans ?? [];
  const rollingWorkouts = plans.filter((p) => !p.is_rest_day);
  const state = program.schedule_state ?? {};
  const overrides = state.overrides ?? {};

  const override = overrides[dateStr];
  if (override) {
    if (override.kind === "rest_push") {
      return { plan: null, isRest: true, isSingleOverride: false };
    }
    if (override.kind === "single") {
      if (override.routineId === "REST") {
        return { plan: null, isRest: true, isSingleOverride: true };
      }
      const matched = plans.find((p) => p.id === override.routineId);
      if (matched) {
        return {
          plan: matched,
          isRest: matched.is_rest_day,
          isSingleOverride: true,
        };
      }
    }
  }

  if (program.schedule_mode === "rolling") {
    if (rollingWorkouts.length === 0) {
      return { plan: null, isRest: true, isSingleOverride: false };
    }

    const sortedAnchors = [...(state.anchors ?? [])].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    const effectiveAnchors =
      sortedAnchors.length > 0
        ? sortedAnchors
        : [
            {
              date: todayDateStr,
              routineId: program.next_routine_id ?? rollingWorkouts[0].id,
            },
          ];

    let activeAnchor = null as (typeof effectiveAnchors)[number] | null;
    for (const anchor of effectiveAnchors) {
      if (anchor.date <= dateStr) {
        activeAnchor = anchor;
      }
    }

    if (activeAnchor) {
      const foundIdx = rollingWorkouts.findIndex(
        (p) => p.id === activeAnchor.routineId
      );
      const baseIdx = Math.max(0, foundIdx);
      const totalDays = diffCalendarDays(activeAnchor.date, dateStr);
      const restPushes = Object.entries(overrides).filter(
        ([d, ov]) =>
          ov.kind === "rest_push" && d >= activeAnchor.date && d < dateStr
      ).length;
      const steps = Math.max(0, totalDays - restPushes);
      const picked = rollingWorkouts[(baseIdx + steps) % rollingWorkouts.length];
      return { plan: picked, isRest: false, isSingleOverride: false };
    }

    // Viewing dates before the first anchor: preserve natural weekday match if present
    const weekday = getIsoWeekdayForDateString(dateStr);
    const weekdayMatch = plans.find((p) => p.day_of_week === weekday);
    if (weekdayMatch) {
      return {
        plan: weekdayMatch,
        isRest: weekdayMatch.is_rest_day,
        isSingleOverride: false,
      };
    }

    const firstAnchor = effectiveAnchors[0];
    const len = rollingWorkouts.length;
    const baseIdx = Math.max(
      0,
      rollingWorkouts.findIndex((p) => p.id === firstAnchor.routineId)
    );
    const daysBefore = diffCalendarDays(dateStr, firstAnchor.date);
    const picked = rollingWorkouts[(((baseIdx - daysBefore) % len) + len) % len];
    return { plan: picked, isRest: false, isSingleOverride: false };
  }

  const weekday = getIsoWeekdayForDateString(dateStr);
  const found = plans.find((p) => p.day_of_week === weekday) ?? plans[0] ?? null;
  return {
    plan: found,
    isRest: Boolean(!found || found.is_rest_day),
    isSingleOverride: false,
  };
}

export function applyDateRoutineAssignment(
  program: WorkoutProgram,
  dateStr: string,
  targetRoutineId: string | "REST",
  scope: "shift" | "single",
  todayDateStr: string
): {
  schedule_state: ProgramScheduleState;
  schedule_mode: ScheduleMode;
  next_routine_id: string | null;
} {
  let anchors = [...(program.schedule_state?.anchors ?? [])];
  const overrides: Record<string, ProgramDateOverride> = {
    ...(program.schedule_state?.overrides ?? {}),
  };
  let schedule_mode: ScheduleMode = program.schedule_mode;

  if (scope === "single") {
    overrides[dateStr] = { kind: "single", routineId: targetRoutineId };
  } else {
    schedule_mode = "rolling";
    const rollingWorkouts = (program.workout_plans ?? []).filter(
      (p) => !p.is_rest_day
    );

    if (targetRoutineId === "REST") {
      if (anchors.length === 0 && rollingWorkouts.length > 0) {
        anchors.push({
          date: todayDateStr,
          routineId: program.next_routine_id ?? rollingWorkouts[0].id,
        });
      }
      overrides[dateStr] = { kind: "rest_push" };
    } else {
      anchors = anchors.filter((a) => a.date < dateStr);
      for (const key of Object.keys(overrides)) {
        if (key >= dateStr) {
          delete overrides[key];
        }
      }
      anchors.push({ date: dateStr, routineId: targetRoutineId });
      anchors.sort((a, b) => a.date.localeCompare(b.date));
      if (anchors.length > 30) {
        anchors = anchors.slice(-30);
      }
    }
  }

  const nextState: ProgramScheduleState = { anchors, overrides };
  const resolvedToday = resolvePlanForDate(
    { ...program, schedule_mode, schedule_state: nextState },
    todayDateStr,
    todayDateStr
  );

  return {
    schedule_state: nextState,
    schedule_mode,
    next_routine_id: resolvedToday.plan?.id ?? program.next_routine_id,
  };
}

export type ProgramPresetKey =
  | "ppl_3"
  | "ppl_6"
  | "upper_lower_4"
  | "full_body_3";

export interface PresetExerciseSpec {
  candidates: string[];
  target_sets: number;
  target_reps: string;
  rest_seconds: number;
}

export interface PresetRoutineSpec {
  name: string;
  short_label: string;
  is_rest_day: boolean;
  notes: string | null;
  exercises: PresetExerciseSpec[];
}

export interface ProgramPresetDefinition {
  key: ProgramPresetKey;
  name: string;
  nameVi: string;
  description: string;
  descriptionVi: string;
  defaultScheduleMode: ScheduleMode;
  routines: PresetRoutineSpec[];
}

/**
 * Produces a concise uppercase chip label for quick-pick routine bars.
 */
export function getRoutineShortLabel(
  plan: Pick<WorkoutPlan, "name" | "short_label" | "is_rest_day">,
  index: number,
  restLabel = "REST"
): string {
  const custom = plan.short_label?.trim();
  if (custom) return custom.toUpperCase();
  if (plan.is_rest_day) return restLabel;

  const stripped = plan.name.replace(/\s*\(.*$/, "").trim();
  if (!stripped) return `D${index + 1}`;
  return stripped.slice(0, 10).toUpperCase();
}

/**
 * Matches verified exercises strictly from the user's Supabase catalog.
 * Never fabricates placeholder exercises or instructions.
 */
export function matchVerifiedExercise(
  catalog: Exercise[],
  candidates: string[]
): Exercise | null {
  if (catalog.length === 0) return null;

  for (const candidate of candidates) {
    const target = candidate.trim().toLowerCase();
    const exact = catalog.find(
      (ex) => ex.name.trim().toLowerCase() === target
    );
    if (exact) return exact;
  }

  for (const candidate of candidates) {
    const target = candidate.trim().toLowerCase();
    const partial = catalog.find((ex) =>
      ex.name.trim().toLowerCase().includes(target)
    );
    if (partial) return partial;
  }

  return null;
}

export const PROGRAM_PRESETS: ProgramPresetDefinition[] = [
  {
    key: "ppl_3",
    name: "Classic 3-Day PPL",
    nameVi: "PPL Cơ Bản (3 Buổi Xoay Vòng)",
    description: "Push • Pull • Legs rolling asynchronously around your life",
    descriptionVi: "Đẩy • Kéo • Chân xoay vòng linh hoạt không phụ thuộc thứ",
    defaultScheduleMode: "rolling",
    routines: [
      {
        name: "Push (Chest, Shoulders, Triceps)",
        short_label: "PUSH",
        is_rest_day: false,
        notes: "5 min warm-up • Optional 15 min incline walk finisher",
        exercises: [
          {
            candidates: ["Barbell Bench Press - Medium Grip", "Barbell Bench Press"],
            target_sets: 4,
            target_reps: "6-10",
            rest_seconds: 120,
          },
          {
            candidates: ["Incline Dumbbell Press"],
            target_sets: 3,
            target_reps: "8-12",
            rest_seconds: 90,
          },
          {
            candidates: ["Barbell Shoulder Press", "Dumbbell Shoulder Press"],
            target_sets: 3,
            target_reps: "8-12",
            rest_seconds: 90,
          },
          {
            candidates: ["Side Lateral Raise"],
            target_sets: 3,
            target_reps: "12-15",
            rest_seconds: 60,
          },
          {
            candidates: ["Triceps Pushdown - Rope Attachment", "Triceps Pushdown"],
            target_sets: 3,
            target_reps: "10-12",
            rest_seconds: 60,
          },
        ],
      },
      {
        name: "Pull (Back, Rear Delts, Biceps)",
        short_label: "PULL",
        is_rest_day: false,
        notes: "Control eccentric, pull with elbows",
        exercises: [
          {
            candidates: ["Wide-Grip Lat Pulldown"],
            target_sets: 3,
            target_reps: "8-12",
            rest_seconds: 90,
          },
          {
            candidates: ["Seated Cable Rows", "T-Bar Row with Handle"],
            target_sets: 3,
            target_reps: "8-12",
            rest_seconds: 90,
          },
          {
            candidates: ["Face Pull"],
            target_sets: 3,
            target_reps: "12-15",
            rest_seconds: 60,
          },
          {
            candidates: ["Barbell Curl", "Dumbbell Bicep Curl"],
            target_sets: 3,
            target_reps: "10-12",
            rest_seconds: 60,
          },
          {
            candidates: ["Hammer Curls"],
            target_sets: 3,
            target_reps: "10-12",
            rest_seconds: 60,
          },
        ],
      },
      {
        name: "Legs (Quads, Hamstrings, Core)",
        short_label: "LEGS",
        is_rest_day: false,
        notes: "2-3 min rest on compounds",
        exercises: [
          {
            candidates: ["Barbell Squat", "Goblet Squat"],
            target_sets: 4,
            target_reps: "6-10",
            rest_seconds: 150,
          },
          {
            candidates: ["Romanian Deadlift"],
            target_sets: 3,
            target_reps: "8-12",
            rest_seconds: 120,
          },
          {
            candidates: ["Leg Press"],
            target_sets: 3,
            target_reps: "10-15",
            rest_seconds: 90,
          },
          {
            candidates: ["Lying Leg Curls"],
            target_sets: 3,
            target_reps: "10-15",
            rest_seconds: 60,
          },
          {
            candidates: ["Standing Calf Raises"],
            target_sets: 3,
            target_reps: "12-20",
            rest_seconds: 60,
          },
          {
            candidates: ["Plank"],
            target_sets: 3,
            target_reps: "60s",
            rest_seconds: 45,
          },
        ],
      },
    ],
  },
  {
    key: "ppl_6",
    name: "6-Day PPL A/B (Rolling)",
    nameVi: "PPL 6 Buổi A/B (Xoay Vòng)",
    description: "Push A • Pull A • Legs A • Push B • Pull B • Legs B",
    descriptionVi: "Push A • Pull A • Legs A • Push B • Pull B • Legs B",
    defaultScheduleMode: "rolling",
    routines: [
      {
        name: "Push A (Strength Focus)",
        short_label: "PUSH A",
        is_rest_day: false,
        notes: "Heavy compound pressing",
        exercises: [
          {
            candidates: ["Barbell Bench Press - Medium Grip"],
            target_sets: 4,
            target_reps: "5-8",
            rest_seconds: 150,
          },
          {
            candidates: ["Barbell Shoulder Press"],
            target_sets: 3,
            target_reps: "6-10",
            rest_seconds: 120,
          },
          {
            candidates: ["Incline Dumbbell Press"],
            target_sets: 3,
            target_reps: "8-12",
            rest_seconds: 90,
          },
          {
            candidates: ["Side Lateral Raise"],
            target_sets: 3,
            target_reps: "12-15",
            rest_seconds: 60,
          },
          {
            candidates: ["Triceps Pushdown - Rope Attachment"],
            target_sets: 3,
            target_reps: "10-12",
            rest_seconds: 60,
          },
        ],
      },
      {
        name: "Pull A (Thickness & Width)",
        short_label: "PULL A",
        is_rest_day: false,
        notes: "Heavy rows + lat pulldown",
        exercises: [
          {
            candidates: ["T-Bar Row with Handle", "Bent Over Barbell Row"],
            target_sets: 4,
            target_reps: "6-10",
            rest_seconds: 120,
          },
          {
            candidates: ["Wide-Grip Lat Pulldown"],
            target_sets: 3,
            target_reps: "8-12",
            rest_seconds: 90,
          },
          {
            candidates: ["Face Pull"],
            target_sets: 3,
            target_reps: "12-15",
            rest_seconds: 60,
          },
          {
            candidates: ["Barbell Curl"],
            target_sets: 3,
            target_reps: "8-12",
            rest_seconds: 60,
          },
        ],
      },
      {
        name: "Legs A (Quad Focus)",
        short_label: "LEGS A",
        is_rest_day: false,
        notes: "Squat primary movement",
        exercises: [
          {
            candidates: ["Barbell Squat"],
            target_sets: 4,
            target_reps: "6-10",
            rest_seconds: 150,
          },
          {
            candidates: ["Leg Press"],
            target_sets: 3,
            target_reps: "10-15",
            rest_seconds: 90,
          },
          {
            candidates: ["Lying Leg Curls"],
            target_sets: 3,
            target_reps: "10-15",
            rest_seconds: 60,
          },
          {
            candidates: ["Standing Calf Raises"],
            target_sets: 3,
            target_reps: "12-20",
            rest_seconds: 60,
          },
        ],
      },
      {
        name: "Push B (Hypertrophy)",
        short_label: "PUSH B",
        is_rest_day: false,
        notes: "Higher rep hypertrophy & stretch",
        exercises: [
          {
            candidates: ["Incline Dumbbell Press"],
            target_sets: 4,
            target_reps: "8-12",
            rest_seconds: 90,
          },
          {
            candidates: ["Dumbbell Flyes"],
            target_sets: 3,
            target_reps: "12-15",
            rest_seconds: 60,
          },
          {
            candidates: ["Side Lateral Raise"],
            target_sets: 4,
            target_reps: "12-15",
            rest_seconds: 60,
          },
          {
            candidates: ["Cable Rope Overhead Triceps Extension"],
            target_sets: 3,
            target_reps: "10-15",
            rest_seconds: 60,
          },
        ],
      },
      {
        name: "Pull B (Cables & Arms)",
        short_label: "PULL B",
        is_rest_day: false,
        notes: "Controlled cable squeeze",
        exercises: [
          {
            candidates: ["Wide-Grip Lat Pulldown"],
            target_sets: 4,
            target_reps: "10-12",
            rest_seconds: 90,
          },
          {
            candidates: ["Seated Cable Rows"],
            target_sets: 4,
            target_reps: "10-12",
            rest_seconds: 90,
          },
          {
            candidates: ["Face Pull"],
            target_sets: 3,
            target_reps: "15",
            rest_seconds: 60,
          },
          {
            candidates: ["Dumbbell Bicep Curl"],
            target_sets: 3,
            target_reps: "10-12",
            rest_seconds: 60,
          },
          {
            candidates: ["Hammer Curls"],
            target_sets: 3,
            target_reps: "10-12",
            rest_seconds: 60,
          },
        ],
      },
      {
        name: "Legs B (Posterior & Core)",
        short_label: "LEGS B",
        is_rest_day: false,
        notes: "Hinge focus + abs",
        exercises: [
          {
            candidates: ["Romanian Deadlift"],
            target_sets: 4,
            target_reps: "8-12",
            rest_seconds: 120,
          },
          {
            candidates: ["Goblet Squat"],
            target_sets: 3,
            target_reps: "12-15",
            rest_seconds: 90,
          },
          {
            candidates: ["Cable Crunch"],
            target_sets: 3,
            target_reps: "12-15",
            rest_seconds: 60,
          },
          {
            candidates: ["Hanging Leg Raise"],
            target_sets: 3,
            target_reps: "10-12",
            rest_seconds: 60,
          },
        ],
      },
    ],
  },
  {
    key: "upper_lower_4",
    name: "Upper / Lower (4-Slot)",
    nameVi: "Upper / Lower (4 Buổi)",
    description: "Upper A • Lower A • Upper B • Lower B",
    descriptionVi: "Thân trên A • Thân dưới A • Thân trên B • Thân dưới B",
    defaultScheduleMode: "rolling",
    routines: [
      {
        name: "Upper A (Strength)",
        short_label: "UPPER A",
        is_rest_day: false,
        notes: "Compound chest & back priority",
        exercises: [
          {
            candidates: ["Barbell Bench Press - Medium Grip"],
            target_sets: 4,
            target_reps: "6-10",
            rest_seconds: 120,
          },
          {
            candidates: ["Seated Cable Rows"],
            target_sets: 4,
            target_reps: "8-12",
            rest_seconds: 90,
          },
          {
            candidates: ["Barbell Shoulder Press"],
            target_sets: 3,
            target_reps: "8-12",
            rest_seconds: 90,
          },
          {
            candidates: ["Wide-Grip Lat Pulldown"],
            target_sets: 3,
            target_reps: "10-12",
            rest_seconds: 90,
          },
          {
            candidates: ["Triceps Pushdown - Rope Attachment"],
            target_sets: 3,
            target_reps: "10-12",
            rest_seconds: 60,
          },
        ],
      },
      {
        name: "Lower A (Quad Focus)",
        short_label: "LOWER A",
        is_rest_day: false,
        notes: "Squat primary + quads & calves",
        exercises: [
          {
            candidates: ["Barbell Squat"],
            target_sets: 4,
            target_reps: "6-10",
            rest_seconds: 150,
          },
          {
            candidates: ["Romanian Deadlift"],
            target_sets: 3,
            target_reps: "8-12",
            rest_seconds: 120,
          },
          {
            candidates: ["Leg Press"],
            target_sets: 3,
            target_reps: "10-15",
            rest_seconds: 90,
          },
          {
            candidates: ["Standing Calf Raises"],
            target_sets: 3,
            target_reps: "12-20",
            rest_seconds: 60,
          },
          {
            candidates: ["Plank"],
            target_sets: 3,
            target_reps: "60s",
            rest_seconds: 45,
          },
        ],
      },
      {
        name: "Upper B (Hypertrophy)",
        short_label: "UPPER B",
        is_rest_day: false,
        notes: "Incline + lateral delts + arms",
        exercises: [
          {
            candidates: ["Incline Dumbbell Press"],
            target_sets: 4,
            target_reps: "8-12",
            rest_seconds: 90,
          },
          {
            candidates: ["Wide-Grip Lat Pulldown"],
            target_sets: 4,
            target_reps: "10-12",
            rest_seconds: 90,
          },
          {
            candidates: ["Side Lateral Raise"],
            target_sets: 3,
            target_reps: "12-15",
            rest_seconds: 60,
          },
          {
            candidates: ["Face Pull"],
            target_sets: 3,
            target_reps: "12-15",
            rest_seconds: 60,
          },
          {
            candidates: ["Barbell Curl"],
            target_sets: 3,
            target_reps: "10-12",
            rest_seconds: 60,
          },
        ],
      },
      {
        name: "Lower B (Posterior & Core)",
        short_label: "LOWER B",
        is_rest_day: false,
        notes: "Hamstrings + glutes + abs",
        exercises: [
          {
            candidates: ["Romanian Deadlift"],
            target_sets: 4,
            target_reps: "8-12",
            rest_seconds: 120,
          },
          {
            candidates: ["Goblet Squat"],
            target_sets: 3,
            target_reps: "12-15",
            rest_seconds: 90,
          },
          {
            candidates: ["Lying Leg Curls"],
            target_sets: 3,
            target_reps: "10-15",
            rest_seconds: 60,
          },
          {
            candidates: ["Cable Crunch"],
            target_sets: 3,
            target_reps: "12-15",
            rest_seconds: 60,
          },
          {
            candidates: ["Hanging Leg Raise"],
            target_sets: 3,
            target_reps: "10-12",
            rest_seconds: 60,
          },
        ],
      },
    ],
  },
  {
    key: "full_body_3",
    name: "Full Body (3-Slot)",
    nameVi: "Toàn Thân (3 Buổi)",
    description: "Full Body A • Full Body B • Full Body C",
    descriptionVi: "Toàn thân A • Toàn thân B • Toàn thân C",
    defaultScheduleMode: "rolling",
    routines: [
      {
        name: "Full Body A",
        short_label: "FULL A",
        is_rest_day: false,
        notes: "Squat + Bench + Row",
        exercises: [
          {
            candidates: ["Barbell Squat"],
            target_sets: 3,
            target_reps: "6-10",
            rest_seconds: 150,
          },
          {
            candidates: ["Barbell Bench Press - Medium Grip"],
            target_sets: 3,
            target_reps: "8-12",
            rest_seconds: 120,
          },
          {
            candidates: ["Seated Cable Rows"],
            target_sets: 3,
            target_reps: "8-12",
            rest_seconds: 90,
          },
          {
            candidates: ["Side Lateral Raise"],
            target_sets: 3,
            target_reps: "12-15",
            rest_seconds: 60,
          },
        ],
      },
      {
        name: "Full Body B",
        short_label: "FULL B",
        is_rest_day: false,
        notes: "Hinge + Overhead Press + Pulldown",
        exercises: [
          {
            candidates: ["Romanian Deadlift"],
            target_sets: 3,
            target_reps: "8-12",
            rest_seconds: 120,
          },
          {
            candidates: ["Barbell Shoulder Press"],
            target_sets: 3,
            target_reps: "8-12",
            rest_seconds: 90,
          },
          {
            candidates: ["Wide-Grip Lat Pulldown"],
            target_sets: 3,
            target_reps: "8-12",
            rest_seconds: 90,
          },
          {
            candidates: ["Plank"],
            target_sets: 3,
            target_reps: "60s",
            rest_seconds: 45,
          },
        ],
      },
      {
        name: "Full Body C",
        short_label: "FULL C",
        is_rest_day: false,
        notes: "Incline + Leg Press + Arms",
        exercises: [
          {
            candidates: ["Leg Press"],
            target_sets: 3,
            target_reps: "10-15",
            rest_seconds: 90,
          },
          {
            candidates: ["Incline Dumbbell Press"],
            target_sets: 3,
            target_reps: "8-12",
            rest_seconds: 90,
          },
          {
            candidates: ["Face Pull"],
            target_sets: 3,
            target_reps: "12-15",
            rest_seconds: 60,
          },
          {
            candidates: ["Dumbbell Bicep Curl"],
            target_sets: 3,
            target_reps: "10-12",
            rest_seconds: 60,
          },
          {
            candidates: ["Triceps Pushdown - Rope Attachment"],
            target_sets: 3,
            target_reps: "10-12",
            rest_seconds: 60,
          },
        ],
      },
    ],
  },
];
