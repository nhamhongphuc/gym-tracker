import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ExercisePickerModal } from "@/components/ExercisePickerModal";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ProgramManagerModal } from "@/components/ProgramManagerModal";
import { RestTimerBar } from "@/components/RestTimerBar";
import { SetRow } from "@/components/SetRow";
import { Colors, Shadows } from "@/constants/theme";
import { formatTemplate, useI18n } from "@/i18n/LanguageContext";
import {
  completeWorkoutSession,
  deleteSetLog,
  fetchActiveTodaySession,
  fetchExercises,
  fetchPrograms,
  getLastPerformedSets,
  getLocalDateString,
  getOrCreateTodaySession,
  saveProgramScheduleState,
  upsertSetLog,
} from "@/lib/api";
import { isCardioExercise } from "@/lib/exerciseUnits";
import {
  CACHE_KEYS,
  flushOfflineQueue,
  generateUuid,
  getPendingCount,
  saveCache,
} from "@/lib/offlineQueue";
import {
  addDaysToDateString,
  applyDateRoutineAssignment,
  getIsoWeekdayForDateString,
  getMondayOfDateString,
  getRoutineShortLabel,
  getWeekDaysFromMonday,
  parseLocalNoon,
  resolvePlanForDate,
} from "@/lib/programTemplates";
import {
  computeSmartSuggestion,
  rankSwapAlternatives,
} from "@/lib/smartCoach";
import type {
  DraftSetRow,
  Exercise,
  PlanExerciseWithDetails,
  SetLog,
  SetType,
  WorkoutPlan,
  WorkoutProgram,
  WorkoutSession,
} from "@/types/database";

const SET_TYPE_ORDER: SetType[] = ["working", "warmup", "dropset", "failure"];

interface TimerState {
  endTimeMs: number;
  totalSeconds: number;
  exerciseName: string;
}

function slotPeKey(dateStr: string, peId: string): string {
  return `${dateStr}__${peId}`;
}

function slotSessionKey(dateStr: string, planId: string): string {
  return `${dateStr}__${planId}`;
}

function buildExtraPlanExercise(
  planId: string,
  exercise: Exercise,
  orderIndex: number
): PlanExerciseWithDetails {
  const cardio = isCardioExercise(exercise);
  return {
    id: `extra_${exercise.id}`,
    plan_id: planId,
    routine_id: planId,
    exercise_id: exercise.id,
    order_index: orderIndex,
    target_sets: cardio ? 1 : 3,
    target_reps: cardio ? "30m" : "8-12",
    rest_seconds: cardio ? 0 : 90,
    exercise,
  };
}

function formatElapsed(startedAtIso: string, nowMs: number): string {
  const startMs = new Date(startedAtIso).getTime();
  if (Number.isNaN(startMs)) return "00:00";
  const totalSecs = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function parseOptionalNumber(raw?: string): number | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildDraftRows(
  pe: PlanExerciseWithDetails,
  exerciseId: string,
  existingLogs: SetLog[],
  previousLogs: SetLog[]
): DraftSetRow[] {
  const logsForExercise = existingLogs.filter(
    (l) => l.exercise_id === exerciseId
  );
  const rowCount = Math.max(pe.target_sets, logsForExercise.length, 1);

  const rows: DraftSetRow[] = [];
  for (let i = 1; i <= rowCount; i++) {
    const existing = logsForExercise.find((l) => l.set_number === i);
    const prev = previousLogs.find((l) => l.set_number === i);

    rows.push({
      local_key: `${pe.id}_set_${i}_${generateUuid().slice(0, 8)}`,
      set_number: i,
      set_type: existing?.set_type ?? prev?.set_type ?? "working",
      weight_kg: existing ? String(existing.weight_kg) : "",
      reps: existing ? String(existing.reps) : "",
      speed_kmh:
        existing?.speed_kmh != null ? String(existing.speed_kmh) : "",
      incline_pct:
        existing?.incline_pct != null ? String(existing.incline_pct) : "",
      prev_weight_kg: prev?.weight_kg,
      prev_reps: prev?.reps,
      prev_speed_kmh: prev?.speed_kmh ?? null,
      prev_incline_pct: prev?.incline_pct ?? null,
      is_completed: Boolean(existing?.is_completed),
      saved_log_id: existing?.id,
    });
  }
  return rows;
}

export default function WorkoutScreen() {
  const { locale, dict, tMuscle, tEquipment, weekdayList } = useI18n();

  const [programs, setPrograms] = useState<WorkoutProgram[]>([]);
  const [todayStr, setTodayStr] = useState(() => getLocalDateString());
  const [selectedDateStr, setSelectedDateStr] = useState(() =>
    getLocalDateString()
  );
  const [weekMondayStr, setWeekMondayStr] = useState(() =>
    getMondayOfDateString(getLocalDateString())
  );
  const [assignScopeOverride, setAssignScopeOverride] = useState<
    "shift" | "single" | null
  >(null);
  const [programModalVisible, setProgramModalVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hydratingDay, setHydratingDay] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-plan active session, drafts, previous sets (for instant EN/VI Smart Coach), and mid-workout swaps
  const [sessionsByPlanId, setSessionsByPlanId] = useState<
    Record<string, WorkoutSession | null>
  >({});
  const [draftsByPeId, setDraftsByPeId] = useState<
    Record<string, DraftSetRow[]>
  >({});
  const [prevSetsByPeId, setPrevSetsByPeId] = useState<
    Record<string, SetLog[]>
  >({});
  const [swappedExerciseByPeId, setSwappedExerciseByPeId] = useState<
    Record<string, Exercise>
  >({});
  const [extraExercisesBySlot, setExtraExercisesBySlot] = useState<
    Record<string, PlanExerciseWithDetails[]>
  >({});
  const [extraPickerVisible, setExtraPickerVisible] = useState(false);

  const hydratedPlanIdsRef = useRef<Record<string, boolean>>({});
  const sessionPromiseRef = useRef<Record<string, Promise<WorkoutSession>>>({});

  // Live elapsed session clock
  const [clockMs, setClockMs] = useState(() => Date.now());

  // Offline sync pill
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncingQueue, setSyncingQueue] = useState(false);

  // Wall-clock rest timer
  const [timerState, setTimerState] = useState<TimerState | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const hasVibratedRef = useRef(false);

  // Mid-workout "Machine Taken?" Swap Modal
  const [swapTargetPe, setSwapTargetPe] =
    useState<PlanExerciseWithDetails | null>(null);
  const [catalog, setCatalog] = useState<Exercise[]>([]);
  const [loadingSwapCatalog, setLoadingSwapCatalog] = useState(false);

  // Finish workout modal
  const [finishModalVisible, setFinishModalVisible] = useState(false);
  const [sessionNotes, setSessionNotes] = useState("");
  const [completing, setCompleting] = useState(false);
  const [completedBanner, setCompletedBanner] = useState<{
    nextName: string | null;
  } | null>(null);

  const refreshPendingCount = useCallback(async () => {
    const count = await getPendingCount();
    setPendingSyncCount(count);
  }, []);

  const handleFlushQueue = useCallback(
    async (silent: boolean) => {
      if (syncingQueue) return;
      setSyncingQueue(true);
      try {
        const result = await flushOfflineQueue();
        setPendingSyncCount(result.remaining);
        if (!silent && result.synced > 0) {
          Alert.alert(
            dict.workout.syncedTitle,
            result.synced === 1
              ? dict.workout.syncedOne
              : formatTemplate(dict.workout.syncedMany, {
                  count: result.synced,
                })
          );
        } else if (!silent && result.remaining > 0) {
          Alert.alert(
            dict.workout.stillOfflineTitle,
            formatTemplate(dict.workout.stillOfflineBody, {
              count: result.remaining,
            })
          );
        }
      } finally {
        setSyncingQueue(false);
      }
    },
    [
      syncingQueue,
      dict.workout.syncedTitle,
      dict.workout.syncedOne,
      dict.workout.syncedMany,
      dict.workout.stillOfflineTitle,
      dict.workout.stillOfflineBody,
    ]
  );

  // Flush offline queue automatically when app returns to foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        setTodayStr(getLocalDateString());
        handleFlushQueue(true);
      }
    });
    return () => sub.remove();
  }, [handleFlushQueue]);

  // Wall-clock countdown interval so locking/backgrounding never causes timer drift
  useEffect(() => {
    if (!timerState) return;

    let dismissTimeout: ReturnType<typeof setTimeout> | null = null;

    const interval = setInterval(() => {
      const rem = Math.max(
        0,
        Math.ceil((timerState.endTimeMs - Date.now()) / 1000)
      );
      setRemainingSeconds(rem);

      if (rem === 0 && !hasVibratedRef.current) {
        hasVibratedRef.current = true;
        if (Platform.OS === "android") {
          Vibration.vibrate([0, 400, 200, 400]);
        } else {
          Vibration.vibrate([0, 400, 600]);
        }
        dismissTimeout = setTimeout(() => {
          setTimerState(null);
        }, 2000);
      }
    }, 250);

    return () => {
      clearInterval(interval);
      if (dismissTimeout) clearTimeout(dismissTimeout);
    };
  }, [timerState]);

  const loadPlansAndSync = useCallback(async () => {
    setTodayStr(getLocalDateString());
    try {
      const [fetchedPrograms, pending] = await Promise.all([
        fetchPrograms(),
        getPendingCount(),
      ]);
      setError(null);
      setPrograms(fetchedPrograms);
      setPendingSyncCount(pending);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.workout.loadError);
    } finally {
      setLoading(false);
    }
  }, [dict.workout.loadError]);

  useFocusEffect(
    useCallback(() => {
      loadPlansAndSync();
    }, [loadPlansAndSync])
  );

  const activeProgram = useMemo(
    () => programs.find((p) => p.is_active) ?? programs[0] ?? null,
    [programs]
  );

  const plans = useMemo(
    () => activeProgram?.workout_plans ?? [],
    [activeProgram]
  );

  const rollingWorkouts = useMemo(
    () => plans.filter((p) => !p.is_rest_day),
    [plans]
  );

  const isRolling = activeProgram?.schedule_mode === "rolling";
  const effectiveScope: "shift" | "single" =
    assignScopeOverride ?? (isRolling ? "shift" : "single");

  const selectedResolution = useMemo(() => {
    if (!activeProgram) {
      return { plan: null, isRest: true, isSingleOverride: false };
    }
    return resolvePlanForDate(activeProgram, selectedDateStr, todayStr);
  }, [activeProgram, selectedDateStr, todayStr]);

  const selectedPlan = selectedResolution.isRest ? null : selectedResolution.plan;
  const isVirtualRest = Boolean(selectedResolution.isRest);

  const weekDays = useMemo(
    () => getWeekDaysFromMonday(weekMondayStr),
    [weekMondayStr]
  );

  const activeSessionKey = selectedPlan
    ? slotSessionKey(selectedDateStr, selectedPlan.id)
    : null;
  const activeSession = activeSessionKey
    ? sessionsByPlanId[activeSessionKey] ?? null
    : null;
  const dayExercises = useMemo(
    () => selectedPlan?.plan_exercises ?? [],
    [selectedPlan]
  );
  const extraExercises = useMemo(
    () =>
      activeSessionKey ? extraExercisesBySlot[activeSessionKey] ?? [] : [],
    [activeSessionKey, extraExercisesBySlot]
  );
  const allDayExercises = useMemo(
    () => [...dayExercises, ...extraExercises],
    [dayExercises, extraExercises]
  );
  const existingDayExerciseIds = useMemo(() => {
    const ids = new Set<string>();
    for (const pe of allDayExercises) {
      const sKey = slotPeKey(selectedDateStr, pe.id);
      ids.add((swappedExerciseByPeId[sKey] ?? pe.exercise).id);
    }
    return ids;
  }, [allDayExercises, swappedExerciseByPeId, selectedDateStr]);

  // Update live elapsed workout duration once an active session exists
  useEffect(() => {
    if (!activeSession?.started_at) return;
    const interval = setInterval(() => {
      setClockMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [activeSession?.started_at]);

  // Hydrate draft rows & previous-session ghost values for the selected date & routine
  const hydratePlan = useCallback(
    async (plan: WorkoutPlan, dateStr: string) => {
      const exercises = plan.plan_exercises ?? [];
      const sessKey = slotSessionKey(dateStr, plan.id);
      if (plan.is_rest_day) {
        hydratedPlanIdsRef.current[sessKey] = true;
        return;
      }

      const alreadyHydrated = Boolean(hydratedPlanIdsRef.current[sessKey]);
      if (!alreadyHydrated && exercises.length > 0) {
        setHydratingDay(true);
      }

      try {
        const { session, existingLogs } = alreadyHydrated
          ? { session: null, existingLogs: [] }
          : await fetchActiveTodaySession(plan.id, dateStr);

        let hydratedExtras: PlanExerciseWithDetails[] = [];
        if (!alreadyHydrated) {
          setSessionsByPlanId((prev) => ({
            ...prev,
            [sessKey]: session,
          }));

          const plannedIds = new Set(exercises.map((pe) => pe.exercise_id));
          const extraIds = Array.from(
            new Set(
              existingLogs
                .map((l) => l.exercise_id)
                .filter((id) => !plannedIds.has(id))
            )
          );
          if (extraIds.length > 0) {
            const allCatalog = await fetchExercises().catch(() => []);
            const byId = new Map(allCatalog.map((ex) => [ex.id, ex]));
            hydratedExtras = extraIds
              .map((exId, idx) => {
                const ex = byId.get(exId);
                return ex
                  ? buildExtraPlanExercise(plan.id, ex, 1000 + idx)
                  : null;
              })
              .filter((x): x is PlanExerciseWithDetails => x !== null);

            if (hydratedExtras.length > 0) {
              setExtraExercisesBySlot((prev) => ({
                ...prev,
                [sessKey]: hydratedExtras,
              }));
            }
          }
        }

        const allToHydrate = [...exercises, ...hydratedExtras];
        const prevResults = await Promise.all(
          allToHydrate.map(async (pe) => {
            const prevSets = await getLastPerformedSets(
              pe.exercise_id,
              session?.id
            ).catch(() => []);
            return { pe, prevSets };
          })
        );

        setDraftsByPeId((prev) => {
          const next = { ...prev };
          for (const { pe, prevSets } of prevResults) {
            const sKey = slotPeKey(dateStr, pe.id);
            if (!next[sKey]) {
              next[sKey] = buildDraftRows(
                pe,
                pe.exercise_id,
                existingLogs,
                prevSets
              );
            }
          }
          return next;
        });

        setPrevSetsByPeId((prev) => {
          const next = { ...prev };
          for (const { pe, prevSets } of prevResults) {
            const sKey = slotPeKey(dateStr, pe.id);
            if (next[sKey] === undefined) {
              next[sKey] = prevSets;
            }
          }
          return next;
        });

        hydratedPlanIdsRef.current[sessKey] = true;
      } finally {
        setHydratingDay(false);
      }
    },
    []
  );

  useEffect(() => {
    if (selectedPlan) {
      hydratePlan(selectedPlan, selectedDateStr);
    }
  }, [selectedPlan, selectedDateStr, hydratePlan]);

  async function ensureSessionForPlan(
    plan: WorkoutPlan,
    dateStr: string
  ): Promise<WorkoutSession> {
    const sessKey = slotSessionKey(dateStr, plan.id);
    const existing = sessionsByPlanId[sessKey];
    if (existing) return existing;

    if (!sessionPromiseRef.current[sessKey]) {
      sessionPromiseRef.current[sessKey] = getOrCreateTodaySession(
        plan,
        dateStr
      )
        .then(({ session }) => {
          setSessionsByPlanId((prev) => ({ ...prev, [sessKey]: session }));
          return session;
        })
        .finally(() => {
          delete sessionPromiseRef.current[sessKey];
        });
    }

    return sessionPromiseRef.current[sessKey];
  }

  function startRestTimer(seconds: number, exerciseName: string) {
    if (seconds <= 0) return;
    hasVibratedRef.current = false;
    setRemainingSeconds(seconds);
    setTimerState(() => ({
      endTimeMs: Date.now() + seconds * 1000,
      totalSeconds: seconds,
      exerciseName,
    }));
  }

  function adjustTimer(deltaSeconds: number) {
    setTimerState((prev) => {
      if (!prev) return null;
      const now = Date.now();
      const nextEnd = Math.max(now, prev.endTimeMs + deltaSeconds * 1000);
      const nextRemaining = Math.max(0, Math.ceil((nextEnd - now) / 1000));
      const nextTotal = Math.max(prev.totalSeconds, nextRemaining);
      if (nextEnd > now) {
        hasVibratedRef.current = false;
      }
      setRemainingSeconds(nextRemaining);
      return {
        ...prev,
        endTimeMs: nextEnd,
        totalSeconds: nextTotal,
      };
    });
  }

  function updateRow(
    slotKey: string,
    localKey: string,
    updater: (row: DraftSetRow) => DraftSetRow
  ) {
    setDraftsByPeId((prev) => ({
      ...prev,
      [slotKey]: (prev[slotKey] ?? []).map((row) =>
        row.local_key === localKey ? updater(row) : row
      ),
    }));
  }

  function getActiveExercise(pe: PlanExerciseWithDetails): Exercise {
    const sKey = slotPeKey(selectedDateStr, pe.id);
    return swappedExerciseByPeId[sKey] ?? pe.exercise;
  }

  function handleApplySuggestion(
    slotKey: string,
    suggestedWeightKg: number,
    suggestedReps: number
  ) {
    setDraftsByPeId((prev) => ({
      ...prev,
      [slotKey]: (prev[slotKey] ?? []).map((row) => {
        if (row.is_completed || row.set_type === "warmup") return row;
        return {
          ...row,
          weight_kg:
            suggestedWeightKg > 0 ? String(suggestedWeightKg) : row.weight_kg,
          reps: String(suggestedReps),
        };
      }),
    }));
  }

  async function handleOpenSwapModal(pe: PlanExerciseWithDetails) {
    setSwapTargetPe(pe);
    if (catalog.length > 0) return;

    setLoadingSwapCatalog(true);
    try {
      const list = await fetchExercises();
      setCatalog(list);
    } catch {
      Alert.alert(
        dict.workout.swapUnavailableTitle,
        dict.workout.swapUnavailableBody
      );
    } finally {
      setLoadingSwapCatalog(false);
    }
  }

  async function handleSelectSwapExercise(replacement: Exercise) {
    if (!swapTargetPe) return;
    const pe = swapTargetPe;
    const sKey = slotPeKey(selectedDateStr, pe.id);
    setSwapTargetPe(null);

    const oldRows = draftsByPeId[sKey] ?? [];
    for (const row of oldRows) {
      if (row.is_completed && row.saved_log_id) {
        await deleteSetLog(row.saved_log_id);
      }
    }

    setSwappedExerciseByPeId((prev) => ({ ...prev, [sKey]: replacement }));

    const prevSets = await getLastPerformedSets(
      replacement.id,
      activeSession?.id
    ).catch(() => []);

    const swappedPe: PlanExerciseWithDetails = {
      ...pe,
      exercise_id: replacement.id,
      exercise: replacement,
    };

    setDraftsByPeId((prev) => ({
      ...prev,
      [sKey]: buildDraftRows(swappedPe, replacement.id, [], prevSets),
    }));
    setPrevSetsByPeId((prev) => ({
      ...prev,
      [sKey]: prevSets,
    }));
    await refreshPendingCount();
  }

  const swapAlternatives = useMemo(() => {
    if (!swapTargetPe || catalog.length === 0) return [];
    const targetKey = slotPeKey(selectedDateStr, swapTargetPe.id);
    const currentEx =
      swappedExerciseByPeId[targetKey] ?? swapTargetPe.exercise;
    const excludeIds = new Set(
      allDayExercises.map((item) => {
        const itemKey = slotPeKey(selectedDateStr, item.id);
        return (swappedExerciseByPeId[itemKey] ?? item.exercise).id;
      })
    );
    return rankSwapAlternatives(currentEx, catalog, excludeIds);
  }, [
    swapTargetPe,
    catalog,
    swappedExerciseByPeId,
    allDayExercises,
    selectedDateStr,
  ]);

  async function handleCycleSetType(
    pe: PlanExerciseWithDetails,
    row: DraftSetRow
  ) {
    const idx = SET_TYPE_ORDER.indexOf(row.set_type);
    const nextType = SET_TYPE_ORDER[(idx + 1) % SET_TYPE_ORDER.length];
    const activeEx = getActiveExercise(pe);
    const sKey = slotPeKey(selectedDateStr, pe.id);

    updateRow(sKey, row.local_key, (r) => ({ ...r, set_type: nextType }));

    if (row.is_completed && selectedPlan) {
      const session = await ensureSessionForPlan(selectedPlan, selectedDateStr);
      await upsertSetLog({
        id: row.saved_log_id,
        session_id: session.id,
        exercise_id: activeEx.id,
        set_number: row.set_number,
        set_type: nextType,
        weight_kg: parseFloat(row.weight_kg) || 0,
        reps: parseInt(row.reps, 10) || 0,
        speed_kmh: parseOptionalNumber(row.speed_kmh),
        incline_pct: parseOptionalNumber(row.incline_pct),
        is_completed: true,
      });
      await refreshPendingCount();
    }
  }

  function handleCopyPrevious(slotKey: string, row: DraftSetRow) {
    if (row.prev_weight_kg === undefined && row.prev_reps === undefined) {
      return;
    }
    updateRow(slotKey, row.local_key, (r) => ({
      ...r,
      weight_kg:
        r.prev_weight_kg !== undefined ? String(r.prev_weight_kg) : r.weight_kg,
      reps: r.prev_reps !== undefined ? String(r.prev_reps) : r.reps,
      speed_kmh:
        r.prev_speed_kmh != null ? String(r.prev_speed_kmh) : r.speed_kmh,
      incline_pct:
        r.prev_incline_pct != null
          ? String(r.prev_incline_pct)
          : r.incline_pct,
    }));
  }

  async function handleToggleComplete(
    pe: PlanExerciseWithDetails,
    row: DraftSetRow
  ) {
    if (!selectedPlan) return;
    const activeEx = getActiveExercise(pe);
    const sKey = slotPeKey(selectedDateStr, pe.id);

    if (row.is_completed) {
      updateRow(sKey, row.local_key, (r) => ({ ...r, is_completed: false }));
      if (row.saved_log_id) {
        await deleteSetLog(row.saved_log_id);
        await refreshPendingCount();
      }
      return;
    }

    const filledWeightStr =
      row.weight_kg.trim() !== ""
        ? row.weight_kg
        : row.prev_weight_kg !== undefined
          ? String(row.prev_weight_kg)
          : "0";
    const filledRepsStr =
      row.reps.trim() !== ""
        ? row.reps
        : row.prev_reps !== undefined
          ? String(row.prev_reps)
          : "0";
    const filledSpeedStr =
      (row.speed_kmh ?? "").trim() !== ""
        ? row.speed_kmh ?? ""
        : row.prev_speed_kmh != null
          ? String(row.prev_speed_kmh)
          : "";
    const filledInclineStr =
      (row.incline_pct ?? "").trim() !== ""
        ? row.incline_pct ?? ""
        : row.prev_incline_pct != null
          ? String(row.prev_incline_pct)
          : "";

    const logId = row.saved_log_id || generateUuid();

    updateRow(sKey, row.local_key, (r) => ({
      ...r,
      weight_kg: filledWeightStr,
      reps: filledRepsStr,
      speed_kmh: filledSpeedStr,
      incline_pct: filledInclineStr,
      is_completed: true,
      saved_log_id: logId,
    }));

    setCompletedBanner(null);
    startRestTimer(pe.rest_seconds, activeEx.name);

    const session = await ensureSessionForPlan(selectedPlan, selectedDateStr);
    const saved = await upsertSetLog({
      id: logId,
      session_id: session.id,
      exercise_id: activeEx.id,
      set_number: row.set_number,
      set_type: row.set_type,
      weight_kg: parseFloat(filledWeightStr) || 0,
      reps: parseInt(filledRepsStr, 10) || 0,
      speed_kmh: parseOptionalNumber(filledSpeedStr),
      incline_pct: parseOptionalNumber(filledInclineStr),
      is_completed: true,
    });

    updateRow(sKey, row.local_key, (r) => ({
      ...r,
      saved_log_id: saved.id ?? logId,
    }));
    await refreshPendingCount();
  }

  function handleAddSet(pe: PlanExerciseWithDetails) {
    const sKey = slotPeKey(selectedDateStr, pe.id);
    setDraftsByPeId((prev) => {
      const current = prev[sKey] ?? [];
      const last = current[current.length - 1];
      const nextNum = current.length + 1;
      const newRow: DraftSetRow = {
        local_key: `${sKey}_set_${nextNum}_${generateUuid().slice(0, 8)}`,
        set_number: nextNum,
        set_type: "working",
        weight_kg: "",
        reps: "",
        speed_kmh: "",
        incline_pct: "",
        prev_weight_kg: last?.prev_weight_kg,
        prev_reps: last?.prev_reps,
        prev_speed_kmh: last?.prev_speed_kmh ?? null,
        prev_incline_pct: last?.prev_incline_pct ?? null,
        is_completed: false,
      };
      return { ...prev, [sKey]: [...current, newRow] };
    });
  }

  async function handleRemoveSet(pe: PlanExerciseWithDetails) {
    const sKey = slotPeKey(selectedDateStr, pe.id);
    const current = draftsByPeId[sKey] ?? [];
    if (current.length <= 1) return;
    const removed = current[current.length - 1];

    setDraftsByPeId((prev) => ({
      ...prev,
      [sKey]: (prev[sKey] ?? []).slice(0, -1),
    }));

    if (removed.is_completed && removed.saved_log_id) {
      await deleteSetLog(removed.saved_log_id);
      await refreshPendingCount();
    }
  }

  async function handleAddExtraExercise(exercise: Exercise) {
    if (!selectedPlan || !activeSessionKey) return;
    if (existingDayExerciseIds.has(exercise.id)) return;

    const extraPe = buildExtraPlanExercise(
      selectedPlan.id,
      exercise,
      1000 + extraExercises.length
    );
    const prevSets = await getLastPerformedSets(
      exercise.id,
      activeSession?.id
    ).catch(() => []);
    const sKey = slotPeKey(selectedDateStr, extraPe.id);

    setExtraExercisesBySlot((prev) => ({
      ...prev,
      [activeSessionKey]: [...(prev[activeSessionKey] ?? []), extraPe],
    }));
    setDraftsByPeId((prev) => ({
      ...prev,
      [sKey]: buildDraftRows(extraPe, exercise.id, [], prevSets),
    }));
    setPrevSetsByPeId((prev) => ({
      ...prev,
      [sKey]: prevSets,
    }));
  }

  async function handleRemoveExtraExercise(pe: PlanExerciseWithDetails) {
    if (!activeSessionKey) return;
    const sKey = slotPeKey(selectedDateStr, pe.id);
    const rows = draftsByPeId[sKey] ?? [];
    for (const row of rows) {
      if (row.is_completed && row.saved_log_id) {
        await deleteSetLog(row.saved_log_id);
      }
    }

    setExtraExercisesBySlot((prev) => ({
      ...prev,
      [activeSessionKey]: (prev[activeSessionKey] ?? []).filter(
        (item) => item.id !== pe.id
      ),
    }));
    setDraftsByPeId((prev) => {
      const next = { ...prev };
      delete next[sKey];
      return next;
    });
    setPrevSetsByPeId((prev) => {
      const next = { ...prev };
      delete next[sKey];
      return next;
    });
    setSwappedExerciseByPeId((prev) => {
      const next = { ...prev };
      delete next[sKey];
      return next;
    });
    await refreshPendingCount();
  }

  const completedSetsCount = useMemo(() => {
    if (!selectedPlan) return 0;
    let count = 0;
    for (const pe of allDayExercises) {
      const sKey = slotPeKey(selectedDateStr, pe.id);
      for (const row of draftsByPeId[sKey] ?? []) {
        if (row.is_completed) count++;
      }
    }
    return count;
  }, [selectedPlan, allDayExercises, draftsByPeId, selectedDateStr]);

  async function handleAssignRoutineForDate(targetRoutineId: string | "REST") {
    if (!activeProgram) return;
    setCompletedBanner(null);

    const updated = applyDateRoutineAssignment(
      activeProgram,
      selectedDateStr,
      targetRoutineId,
      effectiveScope,
      todayStr
    );

    const nextPrograms = programs.map((prog) =>
      prog.id === activeProgram.id
        ? {
            ...prog,
            schedule_state: updated.schedule_state,
            schedule_mode: updated.schedule_mode,
            next_routine_id: updated.next_routine_id,
          }
        : prog
    );

    setPrograms(nextPrograms);
    await saveCache(CACHE_KEYS.PROGRAMS, nextPrograms);
    await saveProgramScheduleState(activeProgram.id, updated);
    await refreshPendingCount();
  }

  async function handleFinishWorkout() {
    if (!selectedPlan || completedSetsCount === 0) return;

    setCompleting(true);
    try {
      const finishedPlan = selectedPlan;
      const finishDate = selectedDateStr;
      const sessKey = slotSessionKey(finishDate, finishedPlan.id);
      const session = await ensureSessionForPlan(finishedPlan, finishDate);
      await completeWorkoutSession(
        session.id,
        sessionNotes.trim() || undefined
      );

      let bannerNextName: string | null = null;
      if (isRolling && activeProgram) {
        const tomorrowStr = addDaysToDateString(finishDate, 1);
        const tomorrowRes = resolvePlanForDate(
          activeProgram,
          tomorrowStr,
          todayStr
        );
        bannerNextName = tomorrowRes.plan?.name ?? null;
      }

      await refreshPendingCount();

      setFinishModalVisible(false);
      setSessionNotes("");
      setTimerState(null);
      setCompletedBanner({ nextName: bannerNextName });

      setSessionsByPlanId((prev) => ({ ...prev, [sessKey]: null }));
      hydratedPlanIdsRef.current[sessKey] = false;
      setExtraExercisesBySlot((prev) => {
        const next = { ...prev };
        delete next[sessKey];
        return next;
      });
      setDraftsByPeId((prev) => {
        const next = { ...prev };
        for (const pe of allDayExercises) {
          delete next[slotPeKey(finishDate, pe.id)];
        }
        return next;
      });
      setPrevSetsByPeId((prev) => {
        const next = { ...prev };
        for (const pe of allDayExercises) {
          delete next[slotPeKey(finishDate, pe.id)];
        }
        return next;
      });
      setSwappedExerciseByPeId((prev) => {
        const next = { ...prev };
        for (const pe of allDayExercises) {
          delete next[slotPeKey(finishDate, pe.id)];
        }
        return next;
      });
    } catch (err) {
      Alert.alert(
        dict.workout.finishFailedTitle,
        err instanceof Error ? err.message : dict.workout.finishFailedBody
      );
    } finally {
      setCompleting(false);
    }
  }

  const selectedDateObj = parseLocalNoon(selectedDateStr);
  const selectedIsoWeekday = getIsoWeekdayForDateString(selectedDateStr);
  const dayMeta =
    weekdayList.find((d) => d.day === selectedIsoWeekday) ?? weekdayList[0];
  const shortDateTag = `${dayMeta.med} ${selectedDateObj.getDate()}/${selectedDateObj.getMonth() + 1}`;
  const relativeDateTag =
    selectedDateStr === todayStr
      ? dict.workout.todayTag
      : selectedDateStr === addDaysToDateString(todayStr, 1)
        ? dict.workout.tomorrowTag
        : null;

  if (loading) {
    return (
      <SafeAreaView
        edges={["top"]}
        style={{ flex: 1, backgroundColor: Colors.background }}
      >
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text className="text-text-secondary text-sm">
            {dict.workout.loadingSplit}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !activeProgram) {
    return (
      <SafeAreaView
        edges={["top"]}
        style={{ flex: 1, backgroundColor: Colors.background }}
      >
        <View className="flex-1 items-center justify-center p-6 gap-3">
          <Ionicons
            name="cloud-offline-outline"
            size={36}
            color={Colors.danger}
          />
          <Text className="text-text-primary text-base font-semibold text-center">
            {error ?? dict.workout.noProgramTitle}
          </Text>
          <Pressable
            onPress={loadPlansAndSync}
            accessibilityRole="button"
            className="min-h-11 px-5 rounded-xl bg-primary items-center justify-center active:opacity-75"
          >
            <Text className="text-black text-sm font-extrabold">
              {dict.common.retry}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const headerEyebrow = `${shortDateTag.toUpperCase()}${
    relativeDateTag ? ` • ${relativeDateTag}` : ""
  }${
    !isVirtualRest && selectedPlan && allDayExercises.length > 0
      ? ` • ${allDayExercises.length} ${dict.workout.exercisesUpper}`
      : ""
  }`;

  const headerTitle = isVirtualRest
    ? dict.workout.restDayTitle
    : selectedPlan?.name ?? dict.workout.restDayTitle;

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: Colors.background }}
    >
      {/* SmartGym Editorial Top Bar */}
      <View className="bg-surface border-b border-border px-4 pt-2 pb-3 gap-3">
        {/* Top Utility Row */}
        <View className="flex-row items-center justify-between gap-2">
          <View className="flex-1 flex-row items-center gap-2 flex-wrap">
            <Pressable
              onPress={() => setProgramModalVisible(true)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Switch program: ${activeProgram.name}`}
              className="min-h-9 flex-row items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-elevated border border-border active:opacity-75"
            >
              <Ionicons
                name={isRolling ? "repeat" : "calendar-outline"}
                size={12}
                color={Colors.primary}
              />
              <Text
                numberOfLines={1}
                className="text-primary text-[11px] font-extrabold max-w-40"
              >
                {activeProgram.name}
              </Text>
              <Ionicons
                name="chevron-down"
                size={12}
                color={Colors.textSecondary}
              />
            </Pressable>

            {selectedDateStr !== todayStr && (
              <Pressable
                onPress={() => {
                  setCompletedBanner(null);
                  setSelectedDateStr(todayStr);
                  setWeekMondayStr(getMondayOfDateString(todayStr));
                }}
                hitSlop={6}
                accessibilityRole="button"
                className="min-h-9 px-2.5 py-1 rounded-full bg-primary-subtle border border-primary/50 items-center justify-center active:opacity-75"
              >
                <Text className="text-primary text-[11px] font-extrabold">
                  {dict.workout.jumpToday}
                </Text>
              </Pressable>
            )}
          </View>

          <View className="flex-row items-center gap-2">
            {pendingSyncCount > 0 && (
              <Pressable
                onPress={() => handleFlushQueue(false)}
                disabled={syncingQueue}
                accessibilityRole="button"
                accessibilityLabel={`Sync ${pendingSyncCount} pending changes`}
                className="min-h-11 px-2.5 rounded-full bg-warning/15 border border-warning/50 flex-row items-center gap-1 active:opacity-75"
              >
                <Ionicons
                  name="cloud-upload-outline"
                  size={15}
                  color={Colors.warning}
                />
                <Text
                  style={{ fontVariant: ["tabular-nums"] }}
                  className="text-warning text-xs font-bold"
                >
                  {syncingQueue ? "..." : `${pendingSyncCount}`}
                </Text>
              </Pressable>
            )}
            <LanguageToggle />
          </View>
        </View>

        {/* Title Row */}
        <View className="flex-row items-center justify-between gap-2">
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <Text className="text-primary text-[11px] font-extrabold uppercase tracking-wider">
                {headerEyebrow}
              </Text>
              {activeSession?.started_at && (
                <View className="px-2 py-0.5 rounded-full bg-surface-elevated border border-border">
                  <Text
                    style={{ fontVariant: ["tabular-nums"] }}
                    className="text-text-primary text-[11px] font-bold"
                  >
                    {formatElapsed(activeSession.started_at, clockMs)}
                  </Text>
                </View>
              )}
            </View>
            <Text
              numberOfLines={1}
              className="text-text-primary text-2xl font-extrabold mt-0.5"
            >
              {headerTitle}
            </Text>
          </View>

          <Pressable
            onPress={() => setFinishModalVisible(true)}
            disabled={completedSetsCount === 0}
            accessibilityRole="button"
            className={`min-h-11 px-3.5 rounded-full items-center justify-center active:opacity-75 ${
              completedSetsCount > 0
                ? "bg-primary"
                : "bg-surface-elevated border border-border opacity-45"
            }`}
          >
            <Text
              className={`text-xs font-extrabold ${
                completedSetsCount > 0 ? "text-black" : "text-text-secondary"
              }`}
            >
              {dict.workout.finish}
            </Text>
          </Pressable>
        </View>

        {/* Interactive Date-Aware 7-Day Week Strip with Scheduled Routine Tags */}
        <View className="flex-row items-center gap-1">
          <Pressable
            onPress={() => {
              const prevMon = addDaysToDateString(weekMondayStr, -7);
              setWeekMondayStr(prevMon);
              setSelectedDateStr(
                prevMon === getMondayOfDateString(todayStr) ? todayStr : prevMon
              );
              setCompletedBanner(null);
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Previous week"
            className="min-h-11 min-w-11 items-center justify-center active:opacity-75"
          >
            <Ionicons
              name="chevron-back"
              size={16}
              color={Colors.textSecondary}
            />
          </Pressable>

          <View className="flex-1 flex-row items-start justify-between">
            {weekDays.map((cell) => {
              const weekdayMeta =
                weekdayList.find((w) => w.day === cell.dayOfWeek) ??
                weekdayList[0];
              const cellRes = resolvePlanForDate(
                activeProgram,
                cell.dateStr,
                todayStr
              );
              const isSelected = cell.dateStr === selectedDateStr;
              const isToday = cell.dateStr === todayStr;
              const cellTag =
                cellRes.isRest || !cellRes.plan
                  ? dict.workout.restChip
                  : getRoutineShortLabel(
                      cellRes.plan,
                      0,
                      dict.workout.restChip
                    );

              return (
                <Pressable
                  key={cell.dateStr}
                  onPress={() => {
                    setCompletedBanner(null);
                    setSelectedDateStr(cell.dateStr);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${weekdayMeta.full} ${cell.dayOfMonth}, ${cellTag}`}
                  accessibilityState={{ selected: isSelected }}
                  className="flex-1 min-h-11 items-center gap-0.5 active:opacity-75"
                >
                  <Text className="text-[10px] font-bold text-text-muted">
                    {weekdayMeta.letter}
                  </Text>
                  <View
                    className={`w-9 h-9 rounded-full border items-center justify-center ${
                      isSelected
                        ? "bg-primary border-primary"
                        : isToday
                          ? "bg-surface-elevated border-primary/80"
                          : "bg-surface-elevated border-border"
                    }`}
                  >
                    <Text
                      style={{ fontVariant: ["tabular-nums"] }}
                      className={`text-xs font-extrabold ${
                        isSelected ? "text-black" : "text-text-primary"
                      }`}
                    >
                      {cell.dayOfMonth}
                    </Text>
                  </View>
                  <Text
                    numberOfLines={1}
                    className={`text-[9px] font-extrabold max-w-11 ${
                      cellRes.isRest || !cellRes.plan
                        ? "text-text-muted"
                        : isSelected
                          ? "text-primary"
                          : "text-text-secondary"
                    }`}
                  >
                    {cellTag}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={() => {
              const nextMon = addDaysToDateString(weekMondayStr, 7);
              setWeekMondayStr(nextMon);
              setSelectedDateStr(
                nextMon === getMondayOfDateString(todayStr) ? todayStr : nextMon
              );
              setCompletedBanner(null);
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Next week"
            className="min-h-11 min-w-11 items-center justify-center active:opacity-75"
          >
            <Ionicons
              name="chevron-forward"
              size={16}
              color={Colors.textSecondary}
            />
          </Pressable>
        </View>

        {/* 1-Tap Routine Assigner for the Selected Date */}
        <View className="gap-2 pt-0.5">
          <View className="flex-row items-center justify-between gap-2">
            <Text className="text-text-secondary text-[11px] font-bold">
              {formatTemplate(dict.workout.assignRoutineLabel, {
                date: shortDateTag,
              })}
            </Text>

            <View className="flex-row bg-surface-elevated rounded-full p-0.5 border border-border">
              {(["shift", "single"] as const).map((sc) => {
                const active = effectiveScope === sc;
                return (
                  <Pressable
                    key={sc}
                    onPress={() => setAssignScopeOverride(sc)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    className={`min-h-9 px-3 items-center justify-center rounded-full active:opacity-75 ${
                      active ? "bg-accent" : ""
                    }`}
                  >
                    <Text
                      className={`text-[10px] font-extrabold ${
                        active ? "text-white" : "text-text-secondary"
                      }`}
                    >
                      {sc === "shift"
                        ? dict.workout.scopeShift
                        : dict.workout.scopeSingle}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingRight: 8 }}
          >
            {rollingWorkouts.map((routine, rIdx) => {
              const active = !isVirtualRest && selectedPlan?.id === routine.id;
              const label = getRoutineShortLabel(
                routine,
                rIdx,
                dict.workout.restChip
              );

              return (
                <Pressable
                  key={routine.id}
                  onPress={() => handleAssignRoutineForDate(routine.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className={`min-h-11 px-3.5 rounded-full border items-center justify-center active:opacity-75 ${
                    active
                      ? "bg-primary border-primary"
                      : "bg-surface-elevated border-border"
                  }`}
                >
                  <Text
                    className={`text-xs font-extrabold ${
                      active ? "text-black" : "text-text-primary"
                    }`}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}

            <Pressable
              onPress={() => handleAssignRoutineForDate("REST")}
              accessibilityRole="button"
              accessibilityState={{ selected: isVirtualRest }}
              className={`min-h-11 px-3.5 rounded-full border flex-row items-center gap-1.5 active:opacity-75 ${
                isVirtualRest
                  ? "bg-primary border-primary"
                  : "bg-surface-elevated border-border"
              }`}
            >
              <Ionicons
                name="bed-outline"
                size={13}
                color={isVirtualRest ? "#000000" : Colors.textSecondary}
              />
              <Text
                className={`text-xs font-extrabold ${
                  isVirtualRest ? "text-black" : "text-text-secondary"
                }`}
              >
                {dict.workout.restChip}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>

      {/* Main Content */}
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            padding: 16,
            paddingBottom: timerState ? 110 : 32,
            gap: 14,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {selectedDateStr > todayStr && (
            <View className="rounded-xl bg-accent/10 border border-accent/35 px-3.5 py-2.5 flex-row items-center gap-2">
              <Ionicons
                name="calendar-outline"
                size={16}
                color={Colors.accent}
              />
              <Text className="flex-1 text-text-primary text-xs font-semibold">
                {formatTemplate(dict.workout.futurePreviewBanner, {
                  date: shortDateTag,
                })}
              </Text>
            </View>
          )}
          {completedBanner && (
            <View className="rounded-2xl bg-primary-subtle border border-primary p-4 flex-row items-center justify-between gap-3">
              <View className="flex-1 flex-row items-center gap-2.5">
                <Ionicons
                  name="trophy-outline"
                  size={22}
                  color={Colors.primary}
                />
                <View className="flex-1">
                  <Text className="text-primary text-sm font-extrabold">
                    {dict.workout.completedTitle}
                  </Text>
                  <Text className="text-text-secondary text-xs">
                    {completedBanner.nextName
                      ? formatTemplate(dict.workout.completedNextUp, {
                          next: completedBanner.nextName,
                        })
                      : dict.workout.completedSubtitle}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => router.push("/(tabs)/history")}
                accessibilityRole="button"
                className="min-h-11 px-3.5 rounded-full bg-primary items-center justify-center active:opacity-75"
              >
                <Text className="text-black text-xs font-extrabold">
                  {dict.workout.viewHistory}
                </Text>
              </Pressable>
            </View>
          )}

          {!isVirtualRest && !!selectedPlan?.notes && !selectedPlan.is_rest_day && (
            <View className="rounded-xl bg-surface border border-border px-3.5 py-2.5 flex-row items-start gap-2">
              <Ionicons
                name="document-text-outline"
                size={16}
                color={Colors.accent}
                style={{ marginTop: 2 }}
              />
              <Text className="flex-1 text-text-secondary text-xs leading-4">
                {selectedPlan.notes}
              </Text>
            </View>
          )}

          {isVirtualRest || !selectedPlan || selectedPlan.is_rest_day ? (
            <View
              style={Shadows.card}
              className="rounded-2xl bg-surface border border-border p-6 items-center gap-3 mt-4"
            >
              <Ionicons name="bed-outline" size={40} color={Colors.accent} />
              <Text className="text-text-primary text-lg font-extrabold">
                {dict.workout.restDayTitle}
              </Text>
              <Text className="text-text-secondary text-sm text-center leading-5">
                {(!isVirtualRest && selectedPlan?.notes) ||
                  dict.workout.restDayDefaultNotes}
              </Text>
              <Text className="text-primary text-xs font-bold mt-1 text-center">
                {isRolling
                  ? dict.workout.restHintRolling
                  : dict.workout.restDayHint}
              </Text>
            </View>
          ) : hydratingDay ? (
            <View className="py-16 items-center justify-center gap-3">
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text className="text-text-secondary text-sm">
                {dict.workout.loadingTargets}
              </Text>
            </View>
          ) : allDayExercises.length === 0 ? (
            <View
              style={Shadows.card}
              className="rounded-2xl bg-surface border border-border p-6 items-center gap-3 mt-4"
            >
              <Ionicons
                name="barbell-outline"
                size={36}
                color={Colors.textMuted}
              />
              <Text className="text-text-primary text-base font-extrabold text-center">
                {dict.workout.noExercisesPrefix}{" "}
                {isRolling ? selectedPlan.name : dayMeta.full}
              </Text>
              <Text className="text-text-secondary text-sm text-center">
                {dict.workout.noExercisesSubtitle}
              </Text>
              <Pressable
                onPress={() => router.push("/(tabs)/plan")}
                accessibilityRole="button"
                className="min-h-11 px-5 rounded-full bg-primary items-center justify-center mt-1 active:opacity-75"
              >
                <Text className="text-black text-sm font-extrabold">
                  {dict.workout.openPlanBuilder}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setExtraPickerVisible(true)}
                accessibilityRole="button"
                className="min-h-11 px-5 rounded-full bg-surface-elevated border border-border flex-row items-center justify-center gap-1.5 active:opacity-75"
              >
                <Ionicons name="add" size={16} color={Colors.primary} />
                <Text className="text-primary text-xs font-extrabold">
                  {dict.workout.addExtraExercise}
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              {allDayExercises.map((pe, idx) => {
              const sKey = slotPeKey(selectedDateStr, pe.id);
              const activeEx = getActiveExercise(pe);
              const isCardio = isCardioExercise(activeEx);
              const isExtra = pe.id.startsWith("extra_");
              const isSwapped = Boolean(swappedExerciseByPeId[sKey]);
              const previewUri =
                activeEx.gif_url ?? activeEx.image_urls[0] ?? null;
              const rows = draftsByPeId[sKey] ?? [];
              const prevSets = prevSetsByPeId[sKey] ?? [];
              const suggestion = computeSmartSuggestion(
                { ...pe, exercise_id: activeEx.id, exercise: activeEx },
                prevSets,
                locale
              );
              const hasIncompleteWorking = rows.some(
                (r) => !r.is_completed && r.set_type !== "warmup"
              );

              return (
                <View
                  key={pe.id}
                  style={Shadows.card}
                  className="rounded-2xl bg-surface border border-border p-3.5 gap-3"
                >
                  {/* Exercise Card Header (Exercise name stays English) */}
                  <View className="flex-row items-center gap-3">
                    <View className="w-12 h-12 rounded-xl bg-media-frame overflow-hidden items-center justify-center">
                      {previewUri ? (
                        <Image
                          source={{ uri: previewUri }}
                          style={{ width: 48, height: 48 }}
                          contentFit="contain"
                          cachePolicy="disk"
                        />
                      ) : (
                        <Ionicons
                          name="barbell-outline"
                          size={20}
                          color={Colors.textMuted}
                        />
                      )}
                    </View>

                    <View className="flex-1">
                      <View className="flex-row items-center gap-1.5">
                        <Text
                          style={{ fontVariant: ["tabular-nums"] }}
                          className="text-primary text-[11px] font-extrabold uppercase"
                        >
                          {idx + 1} {dict.common.of} {allDayExercises.length}
                        </Text>
                        {isExtra && (
                          <View className="px-1.5 py-0.5 rounded bg-primary-subtle">
                            <Text className="text-primary text-[10px] font-bold">
                              {dict.workout.extraBadge}
                            </Text>
                          </View>
                        )}
                        {isSwapped && (
                          <View className="px-1.5 py-0.5 rounded bg-accent/20">
                            <Text className="text-accent text-[10px] font-bold">
                              {dict.workout.swappedBadge}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text
                        numberOfLines={1}
                        className="text-text-primary text-base font-extrabold"
                      >
                        {activeEx.name}
                      </Text>
                      <View className="flex-row items-center gap-2 mt-0.5 flex-wrap">
                        <Text className="text-text-secondary text-xs">
                          {tMuscle(activeEx.muscle_group)} •{" "}
                          {tEquipment(activeEx.equipment)}
                        </Text>
                        <Text
                          style={{ fontVariant: ["tabular-nums"] }}
                          className="text-text-muted text-xs"
                        >
                          • {pe.target_sets}×{pe.target_reps}
                          {pe.rest_seconds > 0 ? ` • ${pe.rest_seconds}s` : ""}
                        </Text>
                      </View>
                    </View>

                    <View className="flex-row items-center gap-2">
                      {isExtra && (
                        <Pressable
                          onPress={() => handleRemoveExtraExercise(pe)}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${activeEx.name}`}
                          className="min-h-11 min-w-11 items-center justify-center rounded-xl bg-surface-elevated border border-border active:opacity-75"
                        >
                          <Ionicons
                            name="close-outline"
                            size={20}
                            color={Colors.danger}
                          />
                        </Pressable>
                      )}
                      <Pressable
                        onPress={() => handleOpenSwapModal(pe)}
                        accessibilityRole="button"
                        accessibilityLabel={`Swap ${activeEx.name}`}
                        className="min-h-11 min-w-11 items-center justify-center rounded-xl bg-surface-elevated border border-border active:opacity-75"
                      >
                        <Ionicons
                          name="swap-horizontal-outline"
                          size={20}
                          color={Colors.textPrimary}
                        />
                      </Pressable>
                      <Pressable
                        onPress={() => router.push(`/exercise/${activeEx.id}`)}
                        accessibilityRole="button"
                        accessibilityLabel={`View details for ${activeEx.name}`}
                        className="min-h-11 min-w-11 items-center justify-center rounded-xl bg-surface-elevated border border-border active:opacity-75"
                      >
                        <Ionicons
                          name="information-circle-outline"
                          size={21}
                          color={Colors.accent}
                        />
                      </Pressable>
                    </View>
                  </View>

                  {/* Smart Trainer Progressive Overload Callout */}
                  {suggestion && hasIncompleteWorking && (
                    <View className="rounded-xl bg-accent/10 border border-accent/35 px-3 py-2 flex-row items-center justify-between gap-2">
                      <View className="flex-1 gap-0.5">
                        <View className="flex-row items-center gap-1.5">
                          <Ionicons
                            name="sparkles"
                            size={13}
                            color={Colors.accent}
                          />
                          <Text className="text-accent text-[11px] font-extrabold uppercase tracking-wider">
                            {dict.smartCoach.title} • {suggestion.badge}
                          </Text>
                        </View>
                        <Text className="text-text-primary text-xs font-bold">
                          {suggestion.headline}
                        </Text>
                        <Text className="text-text-secondary text-[11px]">
                          {suggestion.reason}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() =>
                          handleApplySuggestion(
                            sKey,
                            suggestion.suggestedWeightKg,
                            suggestion.suggestedReps
                          )
                        }
                        accessibilityRole="button"
                        className="min-h-11 px-3.5 rounded-full bg-accent items-center justify-center active:opacity-75"
                      >
                        <Text className="text-white text-xs font-extrabold">
                          {dict.common.apply}
                        </Text>
                      </Pressable>
                    </View>
                  )}

                  {/* Set Columns Header */}
                  <View className="flex-row items-center gap-2 px-2">
                    <Text className="w-11 text-center text-text-muted text-[11px] font-bold">
                      {dict.workout.colSet}
                    </Text>
                    <Text className="flex-1 text-center text-text-muted text-[11px] font-bold">
                      {dict.workout.colPrevious}
                    </Text>
                    <Text className="w-16 text-center text-text-muted text-[11px] font-bold">
                      {isCardio ? dict.workout.colKm : dict.workout.colKg}
                    </Text>
                    <Text className="w-14 text-center text-text-muted text-[11px] font-bold">
                      {isCardio ? dict.workout.colMin : dict.workout.colReps}
                    </Text>
                    <Text className="w-11 text-center text-text-muted text-[11px] font-bold">
                      ✓
                    </Text>
                  </View>

                  {/* Set Rows */}
                  <View className="gap-1.5">
                    {rows.map((row) => (
                      <SetRow
                        key={row.local_key}
                        row={row}
                        isCardio={isCardio}
                        onCycleType={() => handleCycleSetType(pe, row)}
                        onCopyPrevious={() => handleCopyPrevious(sKey, row)}
                        onChangeWeight={(val) =>
                          updateRow(sKey, row.local_key, (r) => ({
                            ...r,
                            weight_kg: val,
                          }))
                        }
                        onChangeReps={(val) =>
                          updateRow(sKey, row.local_key, (r) => ({
                            ...r,
                            reps: val,
                          }))
                        }
                        onChangeSpeed={(val) =>
                          updateRow(sKey, row.local_key, (r) => ({
                            ...r,
                            speed_kmh: val,
                          }))
                        }
                        onChangeIncline={(val) =>
                          updateRow(sKey, row.local_key, (r) => ({
                            ...r,
                            incline_pct: val,
                          }))
                        }
                        onToggleComplete={() => handleToggleComplete(pe, row)}
                      />
                    ))}
                  </View>

                  {/* Card Footer */}
                  <View className="flex-row gap-2 pt-1">
                    <Pressable
                      onPress={() => handleAddSet(pe)}
                      accessibilityRole="button"
                      className="flex-1 min-h-11 rounded-xl bg-surface-elevated border border-border items-center justify-center active:opacity-75"
                    >
                      <Text className="text-text-primary text-xs font-bold">
                        {dict.workout.addSet}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleRemoveSet(pe)}
                      disabled={rows.length <= 1}
                      accessibilityRole="button"
                      className={`flex-1 min-h-11 rounded-xl bg-surface-elevated border border-border items-center justify-center active:opacity-75 ${
                        rows.length <= 1 ? "opacity-40" : ""
                      }`}
                    >
                      <Text className="text-text-secondary text-xs font-bold">
                        {dict.workout.removeSet}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
              })}

              <Pressable
                onPress={() => setExtraPickerVisible(true)}
                accessibilityRole="button"
                className="min-h-11 rounded-2xl bg-surface-elevated border border-dashed border-primary/60 flex-row items-center justify-center gap-2 active:opacity-75"
              >
                <Ionicons name="add" size={18} color={Colors.primary} />
                <Text className="text-primary text-xs font-extrabold">
                  {dict.workout.addExtraExercise}
                </Text>
              </Pressable>

              {completedSetsCount > 0 && (
                <Pressable
                  onPress={() => setFinishModalVisible(true)}
                  style={Shadows.card}
                  accessibilityRole="button"
                  className="min-h-12 rounded-2xl bg-primary flex-row items-center justify-center gap-2 mt-1 active:opacity-75"
                >
                  <Ionicons name="checkmark-done" size={20} color="#000000" />
                  <Text
                    style={{ fontVariant: ["tabular-nums"] }}
                    className="text-black text-sm font-extrabold"
                  >
                    {dict.workout.completeWorkout} ({completedSetsCount})
                  </Text>
                </Pressable>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Floating Rest Timer Capsule */}
      {timerState && (
        <View className="absolute left-0 right-0 bottom-0">
          <RestTimerBar
            remainingSeconds={remainingSeconds}
            totalSeconds={timerState.totalSeconds}
            exerciseName={timerState.exerciseName}
            onAdjust={adjustTimer}
            onSkip={() => setTimerState(null)}
          />
        </View>
      )}

      {/* Mid-Workout "Machine Taken?" Swap Modal */}
      <Modal
        visible={Boolean(swapTargetPe)}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSwapTargetPe(null)}
      >
        <SafeAreaView
          edges={["top", "bottom"]}
          style={{ flex: 1, backgroundColor: Colors.background }}
        >
          <View className="flex-row items-center justify-between px-4 py-3 bg-surface border-b border-border">
            <View className="flex-1 pr-3">
              <Text className="text-primary text-[11px] font-extrabold uppercase">
                {dict.workout.swapEyebrow}
              </Text>
              <Text
                numberOfLines={1}
                className="text-text-primary text-base font-extrabold"
              >
                {dict.workout.swapTitlePrefix}{" "}
                {swapTargetPe ? getActiveExercise(swapTargetPe).name : ""}
              </Text>
            </View>
            <Pressable
              onPress={() => setSwapTargetPe(null)}
              accessibilityRole="button"
              className="min-h-11 min-w-11 items-center justify-center px-2 active:opacity-75"
            >
              <Text className="text-primary text-base font-bold">
                {dict.common.cancel}
              </Text>
            </Pressable>
          </View>

          {loadingSwapCatalog ? (
            <View className="flex-1 items-center justify-center gap-3">
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text className="text-text-secondary text-sm">
                {dict.workout.swapLoading}
              </Text>
            </View>
          ) : (
            <FlatList
              data={swapAlternatives}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 16, gap: 10 }}
              renderItem={({ item }) => {
                const previewUri = item.gif_url ?? item.image_urls[0] ?? null;
                return (
                  <Pressable
                    onPress={() => handleSelectSwapExercise(item)}
                    style={Shadows.card}
                    accessibilityRole="button"
                    className="p-3 rounded-2xl bg-surface border border-border flex-row items-center gap-3 active:opacity-75"
                  >
                    <View className="w-12 h-12 rounded-xl bg-media-frame overflow-hidden items-center justify-center">
                      {previewUri ? (
                        <Image
                          source={{ uri: previewUri }}
                          style={{ width: 48, height: 48 }}
                          contentFit="contain"
                          cachePolicy="disk"
                        />
                      ) : (
                        <Ionicons
                          name="barbell-outline"
                          size={22}
                          color={Colors.textMuted}
                        />
                      )}
                    </View>
                    <View className="flex-1">
                      <Text
                        numberOfLines={1}
                        className="text-text-primary text-sm font-bold"
                      >
                        {item.name}
                      </Text>
                      <Text className="text-text-secondary text-xs mt-0.5">
                        {tMuscle(item.muscle_group)} •{" "}
                        {tEquipment(item.equipment)}
                      </Text>
                    </View>
                    <View className="px-3 py-1.5 rounded-full bg-primary">
                      <Text className="text-black text-xs font-extrabold">
                        {dict.common.swap}
                      </Text>
                    </View>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <View className="py-12 items-center">
                  <Text className="text-text-secondary text-sm">
                    {dict.workout.swapEmpty}
                  </Text>
                </View>
              }
            />
          )}
        </SafeAreaView>
      </Modal>

      {/* Cross-platform Finish Workout Modal */}
      <Modal
        visible={finishModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!completing) setFinishModalVisible(false);
        }}
      >
        <KeyboardAvoidingView
          className="flex-1 bg-black/75 items-center justify-center p-6"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View
            style={Shadows.card}
            className="w-full rounded-2xl bg-surface border border-border p-5 gap-4"
          >
            <View className="gap-1">
              <Text className="text-text-primary text-lg font-extrabold">
                {dict.workout.finishTitle}
              </Text>
              <Text className="text-text-secondary text-xs">
                {completedSetsCount}{" "}
                {completedSetsCount === 1
                  ? dict.workout.finishSetSingle
                  : dict.workout.finishSetPlural}{" "}
                {dict.workout.finishLoggedFor}{" "}
                {selectedPlan?.name ?? dict.workout.restDayTitle}.
              </Text>
            </View>

            <TextInput
              value={sessionNotes}
              onChangeText={setSessionNotes}
              placeholder={dict.workout.finishNotesPlaceholder}
              placeholderTextColor={Colors.textMuted}
              multiline
              className="bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-text-primary text-sm min-h-20"
            />

            <View className="flex-row gap-2.5">
              <Pressable
                onPress={() => setFinishModalVisible(false)}
                disabled={completing}
                accessibilityRole="button"
                className="flex-1 min-h-11 rounded-xl bg-surface-elevated border border-border items-center justify-center active:opacity-75"
              >
                <Text className="text-text-secondary text-sm font-semibold">
                  {dict.workout.keepLifting}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleFinishWorkout}
                disabled={completing}
                accessibilityRole="button"
                className="flex-1 min-h-11 rounded-xl bg-primary items-center justify-center active:opacity-75"
              >
                <Text className="text-black text-sm font-extrabold">
                  {completing
                    ? dict.common.saving
                    : dict.workout.completeWorkout}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ProgramManagerModal
        visible={programModalVisible}
        programs={programs}
        onClose={() => setProgramModalVisible(false)}
        onProgramsChanged={(updated) => {
          setPrograms(updated);
          setAssignScopeOverride(null);
          setCompletedBanner(null);
        }}
      />

      <ExercisePickerModal
        visible={extraPickerVisible}
        title={dict.workout.addExtraTitle}
        onClose={() => setExtraPickerVisible(false)}
        onSelect={handleAddExtraExercise}
        existingExerciseIds={existingDayExerciseIds}
      />
    </SafeAreaView>
  );
}
