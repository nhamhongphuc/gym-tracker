import {
  CACHE_KEYS,
  enqueueOfflineOp,
  generateUuid,
  loadCache,
  saveCache,
} from "@/lib/offlineQueue";
import { supabase } from "@/lib/supabase";
import type {
  Exercise,
  ExercisePRStats,
  PlanExercise,
  PlanExerciseWithDetails,
  SetLog,
  SetType,
  WorkoutPlan,
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
// Group 1 — Plans & Split Builder
// ============================================================

export async function fetchWeeklyPlans(): Promise<WorkoutPlan[]> {
  try {
    const { data, error } = await supabase
      .from("workout_plans")
      .select("*, plan_exercises(*, exercise:exercises(*))")
      .order("day_of_week", { ascending: true });

    if (error) throw error;

    const plans = ((data ?? []) as WorkoutPlan[]).map((plan) => ({
      ...plan,
      plan_exercises: [...(plan.plan_exercises ?? [])].sort(
        (a, b) => a.order_index - b.order_index
      ),
    }));

    await saveCache(CACHE_KEYS.WEEKLY_PLANS, plans);
    return plans;
  } catch (err) {
    const cached = await loadCache<WorkoutPlan[]>(CACHE_KEYS.WEEKLY_PLANS);
    if (cached) return cached;
    throw err;
  }
}

export async function updateDayPlanMeta(
  planId: string,
  updates: Partial<Pick<WorkoutPlan, "name" | "is_rest_day" | "notes">>
): Promise<void> {
  const { error } = await supabase
    .from("workout_plans")
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
    .from("plan_exercises")
    .insert({
      plan_id: planId,
      exercise_id: exerciseId,
      order_index: orderIndex,
    })
    .select("*, exercise:exercises(*)")
    .single();

  if (error) throw error;
  return data as PlanExerciseWithDetails;
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
    .from("plan_exercises")
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
      .from("plan_exercises")
      .update({ order_index: b.order_index })
      .eq("id", a.id),
    supabase
      .from("plan_exercises")
      .update({ order_index: a.order_index })
      .eq("id", b.id),
  ]);

  if (resA.error) throw resA.error;
  if (resB.error) throw resB.error;
}

export async function removePlanExercise(id: string): Promise<void> {
  const { error } = await supabase
    .from("plan_exercises")
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
  input: Omit<Exercise, "id" | "external_id" | "source_name">
): Promise<Exercise> {
  const { data, error } = await supabase
    .from("exercises")
    .insert({
      ...input,
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
  planId: string
): Promise<{ session: WorkoutSession | null; existingLogs: SetLog[] }> {
  const today = getLocalDateString();

  try {
    const { data: existingSession, error: findError } = await supabase
      .from("workout_sessions")
      .select("*")
      .eq("session_date", today)
      .eq("plan_id", planId)
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
  plan: WorkoutPlan
): Promise<{ session: WorkoutSession; existingLogs: SetLog[] }> {
  const today = getLocalDateString();

  try {
    const existing = await fetchActiveTodaySession(plan.id);
    if (existing.session) {
      return { session: existing.session, existingLogs: existing.existingLogs };
    }

    const id = generateUuid();
    const { data: created, error: createError } = await supabase
      .from("workout_sessions")
      .insert({
        id,
        plan_id: plan.id,
        plan_name_snapshot: plan.name,
        session_date: today,
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
      plan_id: plan.id,
      plan_name_snapshot: plan.name,
      session_date: today,
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
  workout_sessions: { session_date: string } | { session_date: string }[] | null;
}

export async function fetchExercisePRStats(
  exerciseId: string
): Promise<ExercisePRStats> {
  const { data, error } = await supabase
    .from("set_logs")
    .select(
      "session_id, set_number, set_type, weight_kg, reps, workout_sessions(session_date)"
    )
    .eq("exercise_id", exerciseId)
    .eq("is_completed", true)
    .order("created_at", { ascending: false });

  if (error) throw error;

  let maxWeightKg = 0;
  let bestEstimated1RM = 0;

  const sessionMap = new Map<
    string,
    {
      sessionDate: string;
      sets: {
        set_number: number;
        weight_kg: number;
        reps: number;
        set_type: SetType;
      }[];
    }
  >();

  for (const row of (data ?? []) as RawPRLogRow[]) {
    const weight = Number(row.weight_kg);
    const reps = Number(row.reps);
    const setNumber = Number(row.set_number);

    if (weight > maxWeightKg) {
      maxWeightKg = weight;
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
      set_type: row.set_type,
    });
  }

  const recentSessions = Array.from(sessionMap.values()).map((session) => ({
    ...session,
    sets: session.sets.sort((a, b) => a.set_number - b.set_number),
  }));

  return {
    maxWeightKg,
    bestEstimated1RM,
    recentSessions,
  };
}
