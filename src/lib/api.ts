import {
  CACHE_KEYS,
  enqueueOfflineOp,
  generateUuid,
  loadCache,
  saveCache,
} from "@/lib/offlineQueue";
import {
  matchVerifiedExercise,
  PROGRAM_PRESETS,
  type ProgramPresetKey,
} from "@/lib/programTemplates";
import { supabase } from "@/lib/supabase";
import type {
  Exercise,
  ExercisePRStats,
  PlanExercise,
  PlanExerciseWithDetails,
  ProgramScheduleState,
  ScheduleMode,
  SetLog,
  SetType,
  WorkoutPlan,
  WorkoutProgram,
  WorkoutSession,
} from "@/types/database";

let exercisesMemoryCache: Exercise[] | null = null;

/**
 * Formats local calendar date as YYYY-MM-DD (avoiding UTC shifts from toISOString()).
 */
export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeSetLog(row: SetLog): SetLog {
  return {
    ...row,
    set_number: Number(row.set_number),
    weight_kg: Number(row.weight_kg),
    reps: Number(row.reps),
    speed_kmh:
      row.speed_kmh !== null && row.speed_kmh !== undefined
        ? Number(row.speed_kmh)
        : null,
    incline_pct:
      row.incline_pct !== null && row.incline_pct !== undefined
        ? Number(row.incline_pct)
        : null,
    rpe: row.rpe !== null && row.rpe !== undefined ? Number(row.rpe) : null,
  };
}

function filterExercises(
  list: Exercise[],
  filters?: { search?: string; muscleGroup?: string; equipment?: string }
): Exercise[] {
  if (!filters) return list;

  const search = filters.search?.trim().toLowerCase();
  const muscleGroup =
    filters.muscleGroup && filters.muscleGroup !== "All"
      ? filters.muscleGroup
      : undefined;
  const equipment =
    filters.equipment && filters.equipment !== "All"
      ? filters.equipment.toLowerCase()
      : undefined;

  return list.filter((ex) => {
    if (muscleGroup && ex.muscle_group !== muscleGroup) return false;
    if (equipment && ex.equipment.toLowerCase() !== equipment) return false;
    if (search) {
      const matchesName = ex.name.toLowerCase().includes(search);
      const matchesMuscle = ex.muscle_group.toLowerCase().includes(search);
      const matchesEquipment = ex.equipment.toLowerCase().includes(search);
      const matchesTarget = ex.target_muscles.some((m) =>
        m.toLowerCase().includes(search)
      );
      if (!matchesName && !matchesMuscle && !matchesEquipment && !matchesTarget) {
        return false;
      }
    }
    return true;
  });
}

// ============================================================
// Group 1 — Programs, Rolling Queues & Split Builder
// ============================================================

interface RawRoutineExerciseRow {
  id: string;
  routine_id: string;
  exercise_id: string;
  order_index: number;
  target_sets: number;
  target_reps: string;
  rest_seconds: number;
  exercise: Exercise;
}

interface RawProgramRoutineRow {
  id: string;
  program_id: string;
  order_index: number;
  day_of_week: number | null;
  short_label: string | null;
  name: string;
  is_rest_day: boolean;
  notes: string | null;
  routine_exercises?: RawRoutineExerciseRow[];
}

function mapRawRoutine(row: RawProgramRoutineRow): WorkoutPlan {
  const mappedExercises: PlanExerciseWithDetails[] = [
    ...(row.routine_exercises ?? []),
  ]
    .sort((a, b) => a.order_index - b.order_index)
    .map((re) => ({
      id: re.id,
      plan_id: re.routine_id,
      routine_id: re.routine_id,
      exercise_id: re.exercise_id,
      order_index: re.order_index,
      target_sets: re.target_sets,
      target_reps: re.target_reps,
      rest_seconds: re.rest_seconds,
      exercise: re.exercise,
    }));

  return {
    id: row.id,
    program_id: row.program_id,
    order_index: row.order_index,
    day_of_week: row.day_of_week,
    short_label: row.short_label,
    name: row.name,
    is_rest_day: row.is_rest_day,
    notes: row.notes,
    plan_exercises: mappedExercises,
  };
}

export async function fetchPrograms(): Promise<WorkoutProgram[]> {
  try {
    const [programsRes, routinesRes] = await Promise.all([
      supabase
        .from("workout_programs")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("program_routines")
        .select("*, routine_exercises(*, exercise:exercises(*))")
        .order("order_index", { ascending: true }),
    ]);

    if (programsRes.error) throw programsRes.error;
    if (routinesRes.error) throw routinesRes.error;

    const routinesByProgram = new Map<string, WorkoutPlan[]>();
    for (const raw of (routinesRes.data ?? []) as RawProgramRoutineRow[]) {
      const mapped = mapRawRoutine(raw);
      const list = routinesByProgram.get(mapped.program_id) ?? [];
      list.push(mapped);
      routinesByProgram.set(mapped.program_id, list);
    }

    const programs = ((programsRes.data ?? []) as WorkoutProgram[]).map(
      (prog) => ({
        ...prog,
        workout_plans: [...(routinesByProgram.get(prog.id) ?? [])].sort(
          (a, b) => a.order_index - b.order_index
        ),
      })
    );

    await saveCache(CACHE_KEYS.PROGRAMS, programs);
    const active = programs.find((p) => p.is_active) ?? programs[0];
    if (active?.workout_plans) {
      await saveCache(CACHE_KEYS.WEEKLY_PLANS, active.workout_plans);
    }

    return programs;
  } catch (err) {
    const cached = await loadCache<WorkoutProgram[]>(CACHE_KEYS.PROGRAMS);
    if (cached && cached.length > 0) return cached;
    throw err;
  }
}

export async function fetchWeeklyPlans(): Promise<WorkoutPlan[]> {
  try {
    const programs = await fetchPrograms();
    const active = programs.find((p) => p.is_active) ?? programs[0];
    return active?.workout_plans ?? [];
  } catch (err) {
    const cached = await loadCache<WorkoutPlan[]>(CACHE_KEYS.WEEKLY_PLANS);
    if (cached) return cached;
    throw err;
  }
}

export async function setActiveProgram(programId: string): Promise<void> {
  const { error: offErr } = await supabase
    .from("workout_programs")
    .update({ is_active: false })
    .neq("id", programId);
  if (offErr) throw offErr;

  const { error: onErr } = await supabase
    .from("workout_programs")
    .update({ is_active: true })
    .eq("id", programId);
  if (onErr) throw onErr;
}

export async function updateProgramMeta(
  programId: string,
  updates: Partial<
    Pick<
      WorkoutProgram,
      "name" | "description" | "schedule_mode" | "next_routine_id"
    >
  >
): Promise<void> {
  if (updates.schedule_mode === "weekly") {
    const { data: existingRoutines, error: rErr } = await supabase
      .from("program_routines")
      .select("id, order_index, day_of_week")
      .eq("program_id", programId)
      .order("order_index", { ascending: true });
    if (rErr) throw rErr;

    const list = (existingRoutines ?? []) as {
      id: string;
      order_index: number;
      day_of_week: number | null;
    }[];

    const usedDays = new Set<number>();
    for (const r of list) {
      if (r.day_of_week && r.day_of_week >= 1 && r.day_of_week <= 7) {
        if (!usedDays.has(r.day_of_week)) {
          usedDays.add(r.day_of_week);
        }
      }
    }

    // Ensure first 7 routines have distinct day_of_week 1..7 if any lack one
    const unassigned = list.slice(0, 7).filter((r) => !r.day_of_week);
    let candidateDay = 1;
    for (const r of unassigned) {
      while (usedDays.has(candidateDay) && candidateDay <= 7) {
        candidateDay++;
      }
      if (candidateDay <= 7) {
        const { error: uErr } = await supabase
          .from("program_routines")
          .update({ day_of_week: candidateDay })
          .eq("id", r.id);
        if (uErr) throw uErr;
        usedDays.add(candidateDay);
      }
    }

    // Fill missing days up to 7 with Rest Day slots so Mon-Sun is complete
    const missingRestRows: {
      program_id: string;
      order_index: number;
      day_of_week: number;
      short_label: string;
      name: string;
      is_rest_day: boolean;
      notes: string;
    }[] = [];
    for (let d = 1; d <= 7; d++) {
      if (!usedDays.has(d)) {
        missingRestRows.push({
          program_id: programId,
          order_index: d - 1,
          day_of_week: d,
          short_label: "REST",
          name: "Rest & Recovery",
          is_rest_day: true,
          notes: "Active recovery, stretching, mobility",
        });
      }
    }
    if (missingRestRows.length > 0) {
      const { error: insErr } = await supabase
        .from("program_routines")
        .insert(missingRestRows);
      if (insErr) throw insErr;
    }
  }

  const { error } = await supabase
    .from("workout_programs")
    .update(updates)
    .eq("id", programId);

  if (error) throw error;
}

export async function advanceProgramQueuePointer(
  programId: string,
  nextRoutineId: string | null
): Promise<void> {
  try {
    const { error } = await supabase
      .from("workout_programs")
      .update({ next_routine_id: nextRoutineId })
      .eq("id", programId);
    if (error) throw error;
  } catch (err) {
    console.warn(
      "[api] advanceProgramQueuePointer failed, queueing offline op:",
      err
    );
    await enqueueOfflineOp({
      type: "advance_program_pointer",
      payload: { programId, nextRoutineId },
      queuedAt: new Date().toISOString(),
    });
  }
}

export async function saveProgramScheduleState(
  programId: string,
  updates: {
    schedule_state: ProgramScheduleState;
    schedule_mode: ScheduleMode;
    next_routine_id: string | null;
  }
): Promise<void> {
  try {
    const { error } = await supabase
      .from("workout_programs")
      .update({
        schedule_state: updates.schedule_state,
        schedule_mode: updates.schedule_mode,
        next_routine_id: updates.next_routine_id,
      })
      .eq("id", programId);
    if (error) throw error;
  } catch (err) {
    console.warn(
      "[api] saveProgramScheduleState failed, queueing offline op:",
      err
    );
    await enqueueOfflineOp({
      type: "update_program_schedule",
      payload: {
        programId,
        schedule_state: updates.schedule_state,
        schedule_mode: updates.schedule_mode,
        next_routine_id: updates.next_routine_id,
      },
      queuedAt: new Date().toISOString(),
    });
  }
}

export async function createProgramFromPreset(
  presetKey: ProgramPresetKey,
  catalog: Exercise[],
  scheduleMode?: ScheduleMode
): Promise<WorkoutProgram> {
  const preset = PROGRAM_PRESETS.find((p) => p.key === presetKey);
  if (!preset) {
    throw new Error(`Unknown preset: ${presetKey}`);
  }

  const mode = scheduleMode ?? preset.defaultScheduleMode;

  const { error: offErr } = await supabase
    .from("workout_programs")
    .update({ is_active: false })
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (offErr) throw offErr;

  const { data: createdProgram, error: progErr } = await supabase
    .from("workout_programs")
    .insert({
      name: preset.name,
      description: preset.description,
      schedule_mode: mode,
      is_active: true,
    })
    .select("*")
    .single();
  if (progErr) throw progErr;

  const routinePayloads = preset.routines.map((r, idx) => ({
    program_id: createdProgram.id,
    order_index: idx,
    day_of_week: idx < 7 ? idx + 1 : null,
    short_label: r.short_label,
    name: r.name,
    is_rest_day: r.is_rest_day,
    notes: r.notes,
  }));

  if (mode === "weekly") {
    for (let d = routinePayloads.length + 1; d <= 7; d++) {
      routinePayloads.push({
        program_id: createdProgram.id,
        order_index: d - 1,
        day_of_week: d,
        short_label: "REST",
        name: "Rest & Recovery",
        is_rest_day: true,
        notes: "Active recovery & mobility",
      });
    }
  }

  const { data: insertedRoutines, error: routErr } = await supabase
    .from("program_routines")
    .insert(routinePayloads)
    .select("*")
    .order("order_index", { ascending: true });
  if (routErr) throw routErr;

  const routineExercisesToInsert: {
    routine_id: string;
    exercise_id: string;
    order_index: number;
    target_sets: number;
    target_reps: string;
    rest_seconds: number;
  }[] = [];

  (insertedRoutines ?? []).forEach((routineRow, rIdx) => {
    const spec = preset.routines[rIdx];
    if (!spec) return;
    let exOrder = 0;
    for (const exSpec of spec.exercises) {
      const match = matchVerifiedExercise(catalog, exSpec.candidates);
      if (!match) continue;
      routineExercisesToInsert.push({
        routine_id: routineRow.id,
        exercise_id: match.id,
        order_index: exOrder++,
        target_sets: exSpec.target_sets,
        target_reps: exSpec.target_reps,
        rest_seconds: exSpec.rest_seconds,
      });
    }
  });

  if (routineExercisesToInsert.length > 0) {
    const { error: exErr } = await supabase
      .from("routine_exercises")
      .insert(routineExercisesToInsert);
    if (exErr) throw exErr;
  }

  const firstRoutine =
    (insertedRoutines ?? []).find((r) => !r.is_rest_day) ??
    insertedRoutines?.[0] ??
    null;

  if (firstRoutine) {
    await supabase
      .from("workout_programs")
      .update({ next_routine_id: firstRoutine.id })
      .eq("id", createdProgram.id);
  }

  const all = await fetchPrograms();
  return (
    all.find((p) => p.id === createdProgram.id) ??
    (createdProgram as WorkoutProgram)
  );
}

export async function createCustomProgram(input: {
  name: string;
  description?: string;
  scheduleMode: ScheduleMode;
  routineCount: number;
}): Promise<WorkoutProgram> {
  const { error: offErr } = await supabase
    .from("workout_programs")
    .update({ is_active: false })
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (offErr) throw offErr;

  const { data: createdProgram, error: progErr } = await supabase
    .from("workout_programs")
    .insert({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      schedule_mode: input.scheduleMode,
      is_active: true,
    })
    .select("*")
    .single();
  if (progErr) throw progErr;

  const slotCount =
    input.scheduleMode === "weekly"
      ? 7
      : Math.min(7, Math.max(2, input.routineCount));

  const routinePayloads = Array.from({ length: slotCount }, (_, idx) => ({
    program_id: createdProgram.id,
    order_index: idx,
    day_of_week: input.scheduleMode === "weekly" ? idx + 1 : null,
    short_label: `DAY ${idx + 1}`,
    name: `Workout ${idx + 1}`,
    is_rest_day: false,
    notes: null,
  }));

  const { data: insertedRoutines, error: routErr } = await supabase
    .from("program_routines")
    .insert(routinePayloads)
    .select("*")
    .order("order_index", { ascending: true });
  if (routErr) throw routErr;

  const firstRoutine = insertedRoutines?.[0] ?? null;
  if (firstRoutine) {
    await supabase
      .from("workout_programs")
      .update({ next_routine_id: firstRoutine.id })
      .eq("id", createdProgram.id);
  }

  const all = await fetchPrograms();
  return (
    all.find((p) => p.id === createdProgram.id) ??
    (createdProgram as WorkoutProgram)
  );
}

export async function deleteProgram(programId: string): Promise<void> {
  const { error } = await supabase
    .from("workout_programs")
    .delete()
    .eq("id", programId);
  if (error) throw error;

  const { data: remaining, error: rErr } = await supabase
    .from("workout_programs")
    .select("id, is_active")
    .order("created_at", { ascending: true });
  if (rErr) throw rErr;

  const list = (remaining ?? []) as { id: string; is_active: boolean }[];
  if (list.length > 0 && !list.some((p) => p.is_active)) {
    await setActiveProgram(list[0].id);
  }
}

export async function addRoutineSlot(
  programId: string,
  input: { name: string; short_label: string; order_index: number }
): Promise<WorkoutPlan> {
  const { data, error } = await supabase
    .from("program_routines")
    .insert({
      program_id: programId,
      name: input.name.trim(),
      short_label: input.short_label.trim().slice(0, 10).toUpperCase(),
      order_index: input.order_index,
      day_of_week: null,
      is_rest_day: false,
      notes: null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return {
    ...(data as RawProgramRoutineRow),
    plan_exercises: [],
  };
}

export async function deleteRoutineSlot(routineId: string): Promise<void> {
  const { error } = await supabase
    .from("program_routines")
    .delete()
    .eq("id", routineId);
  if (error) throw error;
}

export async function updateDayPlanMeta(
  planId: string,
  updates: Partial<
    Pick<WorkoutPlan, "name" | "short_label" | "is_rest_day" | "notes">
  >
): Promise<void> {
  const { error } = await supabase
    .from("program_routines")
    .update(updates)
    .eq("id", planId);

  if (error) throw error;
}

export async function addExerciseToPlan(
  planId: string,
  exerciseId: string,
  orderIndex: number
): Promise<PlanExerciseWithDetails> {
  const { data, error } = await supabase
    .from("routine_exercises")
    .insert({
      routine_id: planId,
      exercise_id: exerciseId,
      order_index: orderIndex,
    })
    .select("*, exercise:exercises(*)")
    .single();

  if (error) throw error;
  const raw = data as RawRoutineExerciseRow;
  return {
    id: raw.id,
    plan_id: raw.routine_id,
    routine_id: raw.routine_id,
    exercise_id: raw.exercise_id,
    order_index: raw.order_index,
    target_sets: raw.target_sets,
    target_reps: raw.target_reps,
    rest_seconds: raw.rest_seconds,
    exercise: raw.exercise,
  };
}

export async function updatePlanExercise(
  id: string,
  updates: Partial<
    Pick<
      PlanExercise,
      "target_sets" | "target_reps" | "rest_seconds" | "order_index"
    >
  >
): Promise<void> {
  const { error } = await supabase
    .from("routine_exercises")
    .update(updates)
    .eq("id", id);

  if (error) throw error;
}

export async function swapPlanExerciseOrder(
  a: PlanExercise,
  b: PlanExercise
): Promise<void> {
  const [resA, resB] = await Promise.all([
    supabase
      .from("routine_exercises")
      .update({ order_index: b.order_index })
      .eq("id", a.id),
    supabase
      .from("routine_exercises")
      .update({ order_index: a.order_index })
      .eq("id", b.id),
  ]);

  if (resA.error) throw resA.error;
  if (resB.error) throw resB.error;
}

export async function removePlanExercise(id: string): Promise<void> {
  const { error } = await supabase
    .from("routine_exercises")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

// ============================================================
// Group 2 — Exercise Library
// ============================================================

export async function fetchExercises(filters?: {
  search?: string;
  muscleGroup?: string;
  equipment?: string;
  forceRefresh?: boolean;
}): Promise<Exercise[]> {
  if (!filters?.forceRefresh && exercisesMemoryCache) {
    return filterExercises(exercisesMemoryCache, filters);
  }

  try {
    const pageSize = 1000;
    const allRows: Exercise[] = [];
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from("exercises")
        .select("*")
        .order("name", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) throw error;
      const chunk = (data ?? []) as Exercise[];
      allRows.push(...chunk);

      if (chunk.length < pageSize) break;
      from += pageSize;
    }

    exercisesMemoryCache = allRows;
    await saveCache(CACHE_KEYS.EXERCISES, allRows);
    return filterExercises(allRows, filters);
  } catch (err) {
    const cached = await loadCache<Exercise[]>(CACHE_KEYS.EXERCISES);
    if (cached) {
      exercisesMemoryCache = cached;
      return filterExercises(cached, filters);
    }
    throw err;
  }
}

export async function fetchExerciseById(id: string): Promise<Exercise | null> {
  try {
    const { data, error } = await supabase
      .from("exercises")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return (data as Exercise | null) ?? null;
  } catch (err) {
    if (exercisesMemoryCache) {
      const found = exercisesMemoryCache.find((ex) => ex.id === id);
      if (found) return found;
    }
    const cached = await loadCache<Exercise[]>(CACHE_KEYS.EXERCISES);
    if (cached) {
      const found = cached.find((ex) => ex.id === id);
      if (found) return found;
    }
    throw err;
  }
}

export async function createCustomExercise(
  input: Omit<Exercise, "id" | "external_id" | "source_name" | "instructions_vi"> & {
    instructions_vi?: string[];
  }
): Promise<Exercise> {
  const { data, error } = await supabase
    .from("exercises")
    .insert({
      ...input,
      instructions_vi: input.instructions_vi ?? [],
      external_id: null,
      source_name: "Custom",
    })
    .select("*")
    .single();

  if (error) throw error;

  const created = data as Exercise;
  exercisesMemoryCache = null;
  return created;
}

export async function updateExerciseMediaAndTips(
  exerciseId: string,
  updates: { video_url?: string | null; tips?: string | null }
): Promise<Exercise> {
  const { data, error } = await supabase
    .from("exercises")
    .update(updates)
    .eq("id", exerciseId)
    .select("*")
    .single();

  if (error) throw error;

  const updated = data as Exercise;
  if (exercisesMemoryCache) {
    exercisesMemoryCache = exercisesMemoryCache.map((ex) =>
      ex.id === exerciseId ? updated : ex
    );
    await saveCache(CACHE_KEYS.EXERCISES, exercisesMemoryCache);
  }
  return updated;
}

// ============================================================
// Group 3 — Active Workout Logging
// ============================================================

export async function getLastPerformedSets(
  exerciseId: string,
  excludeSessionId?: string
): Promise<SetLog[]> {
  let latestQuery = supabase
    .from("set_logs")
    .select("session_id")
    .eq("exercise_id", exerciseId)
    .eq("is_completed", true)
    .order("created_at", { ascending: false })
    .limit(1);

  if (excludeSessionId) {
    latestQuery = latestQuery.neq("session_id", excludeSessionId);
  }

  const { data: latestRow, error: latestError } =
    await latestQuery.maybeSingle();
  if (latestError) throw latestError;
  if (!latestRow?.session_id) return [];

  const { data, error } = await supabase
    .from("set_logs")
    .select("*")
    .eq("session_id", latestRow.session_id)
    .eq("exercise_id", exerciseId)
    .eq("is_completed", true)
    .order("set_number", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as SetLog[]).map(normalizeSetLog);
}

export async function fetchActiveTodaySession(
  routineId: string,
  sessionDate = getLocalDateString()
): Promise<{ session: WorkoutSession | null; existingLogs: SetLog[] }> {
  try {
    const { data: existingSession, error: findError } = await supabase
      .from("workout_sessions")
      .select("*")
      .eq("session_date", sessionDate)
      .eq("routine_id", routineId)
      .is("completed_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) throw findError;
    if (!existingSession) return { session: null, existingLogs: [] };

    const { data: logs, error: logsError } = await supabase
      .from("set_logs")
      .select("*")
      .eq("session_id", existingSession.id)
      .order("set_number", { ascending: true });

    if (logsError) throw logsError;

    return {
      session: existingSession as WorkoutSession,
      existingLogs: ((logs ?? []) as SetLog[]).map(normalizeSetLog),
    };
  } catch (err) {
    console.warn("[api] fetchActiveTodaySession failed:", err);
    return { session: null, existingLogs: [] };
  }
}

export async function getOrCreateTodaySession(
  plan: WorkoutPlan,
  sessionDate = getLocalDateString()
): Promise<{ session: WorkoutSession; existingLogs: SetLog[] }> {
  try {
    const existing = await fetchActiveTodaySession(plan.id, sessionDate);
    if (existing.session) {
      return { session: existing.session, existingLogs: existing.existingLogs };
    }

    const id = generateUuid();
    const { data: created, error: createError } = await supabase
      .from("workout_sessions")
      .insert({
        id,
        plan_id: null,
        routine_id: plan.id,
        plan_name_snapshot: plan.name,
        session_date: sessionDate,
      })
      .select("*")
      .single();

    if (createError) throw createError;

    return {
      session: created as WorkoutSession,
      existingLogs: [],
    };
  } catch (err) {
    console.warn(
      "[api] getOrCreateTodaySession failed, creating optimistic offline session:",
      err
    );
    const nowIso = new Date().toISOString();
    const optimisticSession: WorkoutSession = {
      id: generateUuid(),
      plan_id: null,
      routine_id: plan.id,
      plan_name_snapshot: plan.name,
      session_date: sessionDate,
      started_at: nowIso,
      completed_at: null,
      notes: null,
    };

    await enqueueOfflineOp({
      type: "create_session",
      payload: optimisticSession,
      queuedAt: nowIso,
    });

    return {
      session: optimisticSession,
      existingLogs: [],
    };
  }
}

export async function upsertSetLog(payload: SetLog): Promise<SetLog> {
  const id = payload.id || generateUuid();
  const payloadWithId: SetLog = { ...payload, id };

  try {
    const { data, error } = await supabase
      .from("set_logs")
      .upsert(payloadWithId)
      .select("*")
      .single();

    if (error) throw error;
    return normalizeSetLog(data as SetLog);
  } catch (err) {
    console.warn("[api] upsertSetLog failed, queueing offline op:", err);
    await enqueueOfflineOp({
      type: "upsert_set",
      payload: payloadWithId,
      queuedAt: new Date().toISOString(),
    });
    return normalizeSetLog(payloadWithId);
  }
}

export async function deleteSetLog(id: string): Promise<void> {
  try {
    const { error } = await supabase.from("set_logs").delete().eq("id", id);
    if (error) throw error;
  } catch (err) {
    console.warn("[api] deleteSetLog failed, queueing offline op:", err);
    await enqueueOfflineOp({
      type: "delete_set",
      payload: { id },
      queuedAt: new Date().toISOString(),
    });
  }
}

export async function completeWorkoutSession(
  sessionId: string,
  notes?: string
): Promise<void> {
  const completedAt = new Date().toISOString();

  try {
    const { error } = await supabase
      .from("workout_sessions")
      .update({
        completed_at: completedAt,
        notes: notes ?? null,
      })
      .eq("id", sessionId);

    if (error) throw error;
  } catch (err) {
    console.warn(
      "[api] completeWorkoutSession failed, queueing offline op:",
      err
    );
    await enqueueOfflineOp({
      type: "complete_session",
      payload: { sessionId, notes, completedAt },
      queuedAt: completedAt,
    });
  }
}

// ============================================================
// Group 4 — History & PR Stats
// ============================================================

export async function fetchWorkoutHistory(
  limit = 30
): Promise<WorkoutSession[]> {
  const { data, error } = await supabase
    .from("workout_sessions")
    .select("*, set_logs(*, exercise:exercises(id, name, muscle_group))")
    .not("completed_at", "is", null)
    .order("session_date", { ascending: false })
    .order("completed_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return ((data ?? []) as WorkoutSession[]).map((session) => ({
    ...session,
    set_logs: [...(session.set_logs ?? [])]
      .map((log) => ({
        ...normalizeSetLog(log),
        exercise: log.exercise,
      }))
      .sort((a, b) => a.set_number - b.set_number),
  }));
}

export async function deleteWorkoutSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from("workout_sessions")
    .delete()
    .eq("id", sessionId);

  if (error) throw error;
}

interface RawPRLogRow {
  session_id: string;
  set_number: number;
  set_type: SetType;
  weight_kg: number | string;
  reps: number | string;
  speed_kmh?: number | string | null;
  incline_pct?: number | string | null;
  workout_sessions: { session_date: string } | { session_date: string }[] | null;
}

export async function fetchExercisePRStats(
  exerciseId: string
): Promise<ExercisePRStats> {
  const { data, error } = await supabase
    .from("set_logs")
    .select(
      "session_id, set_number, set_type, weight_kg, reps, speed_kmh, incline_pct, workout_sessions(session_date)"
    )
    .eq("exercise_id", exerciseId)
    .eq("is_completed", true)
    .order("created_at", { ascending: false });

  if (error) throw error;

  let maxWeightKg = 0;
  let maxReps = 0;
  let bestEstimated1RM = 0;

  const sessionMap = new Map<
    string,
    {
      sessionDate: string;
      sets: {
        set_number: number;
        weight_kg: number;
        reps: number;
        speed_kmh?: number | null;
        incline_pct?: number | null;
        set_type: SetType;
      }[];
    }
  >();

  for (const row of (data ?? []) as RawPRLogRow[]) {
    const weight = Number(row.weight_kg);
    const reps = Number(row.reps);
    const speedKmh =
      row.speed_kmh !== null && row.speed_kmh !== undefined
        ? Number(row.speed_kmh)
        : null;
    const inclinePct =
      row.incline_pct !== null && row.incline_pct !== undefined
        ? Number(row.incline_pct)
        : null;
    const setNumber = Number(row.set_number);

    if (weight > maxWeightKg) {
      maxWeightKg = weight;
    }
    if (reps > maxReps) {
      maxReps = reps;
    }

    if (weight > 0 && reps > 0) {
      const est1RM = Math.round(weight * (1 + reps / 30) * 10) / 10;
      if (est1RM > bestEstimated1RM) {
        bestEstimated1RM = est1RM;
      }
    }

    const sessionMeta = Array.isArray(row.workout_sessions)
      ? row.workout_sessions[0]
      : row.workout_sessions;
    const sessionDate = sessionMeta?.session_date ?? "";

    let entry = sessionMap.get(row.session_id);
    if (!entry) {
      if (sessionMap.size >= 5) continue;
      entry = { sessionDate, sets: [] };
      sessionMap.set(row.session_id, entry);
    }

    entry.sets.push({
      set_number: setNumber,
      weight_kg: weight,
      reps,
      speed_kmh: speedKmh,
      incline_pct: inclinePct,
      set_type: row.set_type,
    });
  }

  const recentSessions = Array.from(sessionMap.values()).map((session) => ({
    ...session,
    sets: session.sets.sort((a, b) => a.set_number - b.set_number),
  }));

  return {
    maxWeightKg,
    maxReps,
    bestEstimated1RM,
    recentSessions,
  };
}
