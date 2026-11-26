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
import { RestTimerBar } from "@/components/RestTimerBar";
import { SetRow } from "@/components/SetRow";
import { Colors, Shadows } from "@/constants/theme";
import {
  completeWorkoutSession,
  deleteSetLog,
  fetchActiveTodaySession,
  fetchExercises,
  fetchWeeklyPlans,
  getLastPerformedSets,
  getOrCreateTodaySession,
  upsertSetLog,
} from "@/lib/api";
import {
  flushOfflineQueue,
  generateUuid,
  getPendingCount,
} from "@/lib/offlineQueue";
import {
  computeSmartSuggestion,
  rankSwapAlternatives,
  type SmartSuggestion,
} from "@/lib/smartCoach";
import type {
  DraftSetRow,
  Exercise,
  PlanExerciseWithDetails,
  SetLog,
  SetType,
  WorkoutPlan,
  WorkoutSession,
} from "@/types/database";

const DAY_PILLS = [
  { day: 1, letter: "M", full: "Monday" },
  { day: 2, letter: "T", full: "Tuesday" },
  { day: 3, letter: "W", full: "Wednesday" },
  { day: 4, letter: "T", full: "Thursday" },
  { day: 5, letter: "F", full: "Friday" },
  { day: 6, letter: "S", full: "Saturday" },
  { day: 7, letter: "S", full: "Sunday" },
] as const;

const SET_TYPE_ORDER: SetType[] = ["working", "warmup", "dropset", "failure"];

interface TimerState {
  endTimeMs: number;
  totalSeconds: number;
  exerciseName: string;
}

function getTodayIsoWeekday(): number {
  return ((new Date().getDay() + 6) % 7) + 1;
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
      prev_weight_kg: prev?.weight_kg,
      prev_reps: prev?.reps,
      is_completed: Boolean(existing?.is_completed),
      saved_log_id: existing?.id,
    });
  }
  return rows;
}

export default function WorkoutScreen() {
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [selectedDay, setSelectedDay] = useState<number>(getTodayIsoWeekday);
  const [loading, setLoading] = useState(true);
  const [hydratingDay, setHydratingDay] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-plan active session, drafts, Smart Trainer suggestions, and mid-workout swaps
  const [sessionsByPlanId, setSessionsByPlanId] = useState<
    Record<string, WorkoutSession | null>
  >({});
  const [draftsByPeId, setDraftsByPeId] = useState<
    Record<string, DraftSetRow[]>
  >({});
  const [suggestionsByPeId, setSuggestionsByPeId] = useState<
    Record<string, SmartSuggestion | null>
  >({});
  const [swappedExerciseByPeId, setSwappedExerciseByPeId] = useState<
    Record<string, Exercise>
  >({});

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
  const [completedBanner, setCompletedBanner] = useState(false);

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
            "Synced",
            `Synced ${result.synced} offline ${
              result.synced === 1 ? "operation" : "operations"
            } to Supabase.`
          );
        } else if (!silent && result.remaining > 0) {
          Alert.alert(
            "Still Offline",
            `${result.remaining} operation(s) waiting for connection.`
          );
        }
      } finally {
        setSyncingQueue(false);
      }
    },
    [syncingQueue]
  );

  // Flush offline queue automatically when app returns to foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
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
    try {
      const [fetchedPlans, pending] = await Promise.all([
        fetchWeeklyPlans(),
        getPendingCount(),
      ]);
      setError(null);
      setPlans(fetchedPlans);
      setPendingSyncCount(pending);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load workout split."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadPlansAndSync();
    }, [loadPlansAndSync])
  );

  const selectedPlan = useMemo(
    () => plans.find((p) => p.day_of_week === selectedDay) ?? null,
    [plans, selectedDay]
  );

  const activeSession = selectedPlan
    ? sessionsByPlanId[selectedPlan.id] ?? null
    : null;

  // Update live elapsed workout duration once an active session exists
  useEffect(() => {
    if (!activeSession?.started_at) return;
    const interval = setInterval(() => {
      setClockMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [activeSession?.started_at]);

  // Hydrate draft rows, previous-session ghost values & Smart Trainer suggestions
  const hydratePlan = useCallback(async (plan: WorkoutPlan) => {
    const exercises = plan.plan_exercises ?? [];
    if (plan.is_rest_day || exercises.length === 0) {
      hydratedPlanIdsRef.current[plan.id] = true;
      return;
    }

    const alreadyHydrated = Boolean(hydratedPlanIdsRef.current[plan.id]);
    if (!alreadyHydrated) {
      setHydratingDay(true);
    }

    try {
      const { session, existingLogs } = alreadyHydrated
        ? { session: null, existingLogs: [] }
        : await fetchActiveTodaySession(plan.id);

      if (!alreadyHydrated) {
        setSessionsByPlanId((prev) => ({
          ...prev,
          [plan.id]: session,
        }));
      }

      const prevResults = await Promise.all(
        exercises.map(async (pe) => {
          const prevSets = await getLastPerformedSets(
            pe.exercise_id,
            session?.id
          ).catch(() => []);
          const suggestion = computeSmartSuggestion(pe, prevSets);
          return { pe, prevSets, suggestion };
        })
      );

      setDraftsByPeId((prev) => {
        const next = { ...prev };
        for (const { pe, prevSets } of prevResults) {
          if (!next[pe.id]) {
            next[pe.id] = buildDraftRows(
              pe,
              pe.exercise_id,
              existingLogs,
              prevSets
            );
          }
        }
        return next;
      });

      setSuggestionsByPeId((prev) => {
        const next = { ...prev };
        for (const { pe, suggestion } of prevResults) {
          if (next[pe.id] === undefined) {
            next[pe.id] = suggestion;
          }
        }
        return next;
      });

      hydratedPlanIdsRef.current[plan.id] = true;
    } finally {
      setHydratingDay(false);
    }
  }, []);

  useEffect(() => {
    if (selectedPlan) {
      hydratePlan(selectedPlan);
    }
  }, [selectedPlan, hydratePlan]);

  async function ensureSessionForPlan(
    plan: WorkoutPlan
  ): Promise<WorkoutSession> {
    const existing = sessionsByPlanId[plan.id];
    if (existing) return existing;

    if (!sessionPromiseRef.current[plan.id]) {
      sessionPromiseRef.current[plan.id] = getOrCreateTodaySession(plan)
        .then(({ session }) => {
          setSessionsByPlanId((prev) => ({ ...prev, [plan.id]: session }));
          return session;
        })
        .finally(() => {
          delete sessionPromiseRef.current[plan.id];
        });
    }

    return sessionPromiseRef.current[plan.id];
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
    peId: string,
    localKey: string,
    updater: (row: DraftSetRow) => DraftSetRow
  ) {
    setDraftsByPeId((prev) => ({
      ...prev,
      [peId]: (prev[peId] ?? []).map((row) =>
        row.local_key === localKey ? updater(row) : row
      ),
    }));
  }

  function getActiveExercise(pe: PlanExerciseWithDetails): Exercise {
    return swappedExerciseByPeId[pe.id] ?? pe.exercise;
  }

  function handleApplySuggestion(
    peId: string,
    suggestion: SmartSuggestion
  ) {
    setDraftsByPeId((prev) => ({
      ...prev,
      [peId]: (prev[peId] ?? []).map((row) => {
        if (row.is_completed || row.set_type === "warmup") return row;
        return {
          ...row,
          weight_kg:
            suggestion.suggestedWeightKg > 0
              ? String(suggestion.suggestedWeightKg)
              : row.weight_kg,
          reps: String(suggestion.suggestedReps),
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
      Alert.alert("Unavailable", "Could not load exercise alternatives.");
    } finally {
      setLoadingSwapCatalog(false);
    }
  }

  async function handleSelectSwapExercise(replacement: Exercise) {
    if (!swapTargetPe) return;
    const pe = swapTargetPe;
    setSwapTargetPe(null);

    const oldRows = draftsByPeId[pe.id] ?? [];
    for (const row of oldRows) {
      if (row.is_completed && row.saved_log_id) {
        await deleteSetLog(row.saved_log_id);
      }
    }

    setSwappedExerciseByPeId((prev) => ({ ...prev, [pe.id]: replacement }));

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
      [pe.id]: buildDraftRows(swappedPe, replacement.id, [], prevSets),
    }));
    setSuggestionsByPeId((prev) => ({
      ...prev,
      [pe.id]: computeSmartSuggestion(swappedPe, prevSets),
    }));
    await refreshPendingCount();
  }

  const swapAlternatives = useMemo(() => {
    if (!swapTargetPe || catalog.length === 0) return [];
    const currentEx = swappedExerciseByPeId[swapTargetPe.id] ?? swapTargetPe.exercise;
    const excludeIds = new Set(
      (selectedPlan?.plan_exercises ?? []).map(
        (item) => (swappedExerciseByPeId[item.id] ?? item.exercise).id
      )
    );
    return rankSwapAlternatives(currentEx, catalog, excludeIds);
  }, [swapTargetPe, catalog, swappedExerciseByPeId, selectedPlan]);

  async function handleCycleSetType(
    pe: PlanExerciseWithDetails,
    row: DraftSetRow
  ) {
    const idx = SET_TYPE_ORDER.indexOf(row.set_type);
    const nextType = SET_TYPE_ORDER[(idx + 1) % SET_TYPE_ORDER.length];
    const activeEx = getActiveExercise(pe);

    updateRow(pe.id, row.local_key, (r) => ({ ...r, set_type: nextType }));

    if (row.is_completed && selectedPlan) {
      const session = await ensureSessionForPlan(selectedPlan);
      await upsertSetLog({
        id: row.saved_log_id,
        session_id: session.id,
        exercise_id: activeEx.id,
        set_number: row.set_number,
        set_type: nextType,
        weight_kg: parseFloat(row.weight_kg) || 0,
        reps: parseInt(row.reps, 10) || 0,
        is_completed: true,
      });
      await refreshPendingCount();
    }
  }

  function handleCopyPrevious(peId: string, row: DraftSetRow) {
    if (row.prev_weight_kg === undefined && row.prev_reps === undefined) {
      return;
    }
    updateRow(peId, row.local_key, (r) => ({
      ...r,
      weight_kg:
        r.prev_weight_kg !== undefined ? String(r.prev_weight_kg) : r.weight_kg,
      reps: r.prev_reps !== undefined ? String(r.prev_reps) : r.reps,
    }));
  }

  async function handleToggleComplete(
    pe: PlanExerciseWithDetails,
    row: DraftSetRow
  ) {
    if (!selectedPlan) return;
    const activeEx = getActiveExercise(pe);

    if (row.is_completed) {
      updateRow(pe.id, row.local_key, (r) => ({ ...r, is_completed: false }));
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

    const logId = row.saved_log_id || generateUuid();

    updateRow(pe.id, row.local_key, (r) => ({
      ...r,
      weight_kg: filledWeightStr,
      reps: filledRepsStr,
      is_completed: true,
      saved_log_id: logId,
    }));

    setCompletedBanner(false);
    startRestTimer(pe.rest_seconds, activeEx.name);

    const session = await ensureSessionForPlan(selectedPlan);
    const saved = await upsertSetLog({
      id: logId,
      session_id: session.id,
      exercise_id: activeEx.id,
      set_number: row.set_number,
      set_type: row.set_type,
      weight_kg: parseFloat(filledWeightStr) || 0,
      reps: parseInt(filledRepsStr, 10) || 0,
      is_completed: true,
    });

    updateRow(pe.id, row.local_key, (r) => ({
      ...r,
      saved_log_id: saved.id ?? logId,
    }));
    await refreshPendingCount();
  }

  function handleAddSet(pe: PlanExerciseWithDetails) {
    setDraftsByPeId((prev) => {
      const current = prev[pe.id] ?? [];
      const last = current[current.length - 1];
      const nextNum = current.length + 1;
      const newRow: DraftSetRow = {
        local_key: `${pe.id}_set_${nextNum}_${generateUuid().slice(0, 8)}`,
        set_number: nextNum,
        set_type: "working",
        weight_kg: "",
        reps: "",
        prev_weight_kg: last?.prev_weight_kg,
        prev_reps: last?.prev_reps,
        is_completed: false,
      };
      return { ...prev, [pe.id]: [...current, newRow] };
    });
  }

  async function handleRemoveSet(pe: PlanExerciseWithDetails) {
    const current = draftsByPeId[pe.id] ?? [];
    if (current.length <= 1) return;
    const removed = current[current.length - 1];

    setDraftsByPeId((prev) => ({
      ...prev,
      [pe.id]: (prev[pe.id] ?? []).slice(0, -1),
    }));

    if (removed.is_completed && removed.saved_log_id) {
      await deleteSetLog(removed.saved_log_id);
      await refreshPendingCount();
    }
  }

  const completedSetsCount = useMemo(() => {
    if (!selectedPlan) return 0;
    let count = 0;
    for (const pe of selectedPlan.plan_exercises ?? []) {
      for (const row of draftsByPeId[pe.id] ?? []) {
        if (row.is_completed) count++;
      }
    }
    return count;
  }, [selectedPlan, draftsByPeId]);

  async function handleFinishWorkout() {
    if (!selectedPlan || completedSetsCount === 0) return;

    setCompleting(true);
    try {
      const session = await ensureSessionForPlan(selectedPlan);
      await completeWorkoutSession(
        session.id,
        sessionNotes.trim() || undefined
      );
      await refreshPendingCount();

      setFinishModalVisible(false);
      setSessionNotes("");
      setTimerState(null);
      setCompletedBanner(true);

      setSessionsByPlanId((prev) => ({ ...prev, [selectedPlan.id]: null }));
      hydratedPlanIdsRef.current[selectedPlan.id] = false;
      setDraftsByPeId((prev) => {
        const next = { ...prev };
        for (const pe of selectedPlan.plan_exercises ?? []) {
          delete next[pe.id];
        }
        return next;
      });
      setSwappedExerciseByPeId((prev) => {
        const next = { ...prev };
        for (const pe of selectedPlan.plan_exercises ?? []) {
          delete next[pe.id];
        }
        return next;
      });
    } catch (err) {
      Alert.alert(
        "Finish Failed",
        err instanceof Error ? err.message : "Could not complete workout."
      );
    } finally {
      setCompleting(false);
    }
  }

  const dayMeta = DAY_PILLS.find((d) => d.day === selectedDay) ?? DAY_PILLS[0];
  const dayExercises = selectedPlan?.plan_exercises ?? [];

  if (loading) {
    return (
      <SafeAreaView
        edges={["top"]}
        style={{ flex: 1, backgroundColor: Colors.background }}
      >
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text className="text-text-secondary text-sm">
            Loading today&apos;s split...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !selectedPlan) {
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
            {error ?? "Could not load workout plan."}
          </Text>
          <Pressable
            onPress={loadPlansAndSync}
            className="min-h-11 px-5 rounded-xl bg-primary items-center justify-center"
          >
            <Text className="text-black text-sm font-extrabold">Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: Colors.background }}
    >
      {/* SmartGym Editorial Top Bar */}
      <View className="bg-surface border-b border-border px-4 pt-2 pb-3 gap-3">
        <View className="flex-row items-center justify-between gap-2">
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <Text className="text-primary text-[11px] font-extrabold uppercase tracking-wider">
                {dayMeta.full}
                {!selectedPlan.is_rest_day && dayExercises.length > 0
                  ? ` • ${dayExercises.length} EXERCISES`
                  : ""}
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
              {selectedPlan.name}
            </Text>
          </View>

          <View className="flex-row items-center gap-2">
            {pendingSyncCount > 0 && (
              <Pressable
                onPress={() => handleFlushQueue(false)}
                disabled={syncingQueue}
                className="min-h-11 px-3 rounded-full bg-warning/15 border border-warning/50 flex-row items-center gap-1.5"
              >
                <Ionicons
                  name="cloud-upload-outline"
                  size={16}
                  color={Colors.warning}
                />
                <Text className="text-warning text-xs font-bold">
                  {syncingQueue ? "Syncing" : `${pendingSyncCount}`}
                </Text>
              </Pressable>
            )}

            <Pressable
              onPress={() => setFinishModalVisible(true)}
              disabled={completedSetsCount === 0}
              className={`min-h-11 px-4 rounded-full items-center justify-center ${
                completedSetsCount > 0
                  ? "bg-primary"
                  : "bg-surface-elevated border border-border opacity-45"
              }`}
            >
              <Text
                className={`text-sm font-extrabold ${
                  completedSetsCount > 0 ? "text-black" : "text-text-secondary"
                }`}
              >
                Finish
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Circular Neon-Lime 7-Day Selector */}
        <View className="flex-row items-center justify-between">
          {DAY_PILLS.map((pill) => {
            const active = selectedDay === pill.day;
            const isToday = getTodayIsoWeekday() === pill.day;
            return (
              <Pressable
                key={pill.day}
                onPress={() => {
                  setCompletedBanner(false);
                  setSelectedDay(pill.day);
                }}
                className="min-h-11 min-w-11 items-center justify-center gap-1"
              >
                <View
                  className={`w-10 h-10 rounded-full border items-center justify-center ${
                    active
                      ? "bg-primary border-primary"
                      : "bg-surface-elevated border-border"
                  }`}
                >
                  <Text
                    className={`text-sm font-extrabold ${
                      active ? "text-black" : "text-text-secondary"
                    }`}
                  >
                    {pill.letter}
                  </Text>
                </View>
                <View
                  className={`w-1.5 h-1.5 rounded-full ${
                    isToday ? "bg-primary" : "bg-transparent"
                  }`}
                />
              </Pressable>
            );
          })}
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
                    Workout Completed!
                  </Text>
                  <Text className="text-text-secondary text-xs">
                    Saved to your history &amp; muscle recovery map.
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => router.push("/(tabs)/history")}
                className="min-h-10 px-3.5 rounded-full bg-primary items-center justify-center"
              >
                <Text className="text-black text-xs font-extrabold">
                  History
                </Text>
              </Pressable>
            </View>
          )}

          {!!selectedPlan.notes && !selectedPlan.is_rest_day && (
            <View className="rounded-xl bg-surface border border-border px-3.5 py-2.5 flex-row items-center gap-2">
              <Ionicons
                name="document-text-outline"
                size={16}
                color={Colors.accent}
              />
              <Text className="flex-1 text-text-secondary text-xs">
                {selectedPlan.notes}
              </Text>
            </View>
          )}

          {selectedPlan.is_rest_day ? (
            <View
              style={Shadows.card}
              className="rounded-2xl bg-surface border border-border p-6 items-center gap-3 mt-4"
            >
              <Ionicons name="bed-outline" size={40} color={Colors.accent} />
              <Text className="text-text-primary text-lg font-extrabold">
                Rest &amp; Recovery Day
              </Text>
              <Text className="text-text-secondary text-sm text-center">
                {selectedPlan.notes ||
                  "Active recovery, stretching, and mobility."}
              </Text>
              <Text className="text-primary text-xs font-bold mt-1">
                Log Another Day&apos;s Split using the M–S circles above
              </Text>
            </View>
          ) : hydratingDay ? (
            <View className="py-16 items-center justify-center gap-3">
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text className="text-text-secondary text-sm">
                Loading sets &amp; Smart Trainer targets...
              </Text>
            </View>
          ) : dayExercises.length === 0 ? (
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
                No Exercises Planned for {dayMeta.full}
              </Text>
              <Text className="text-text-secondary text-sm text-center">
                Build your split in the Plan tab to start logging sets here.
              </Text>
              <Pressable
                onPress={() => router.push("/(tabs)/plan")}
                className="min-h-11 px-5 rounded-full bg-primary items-center justify-center mt-1"
              >
                <Text className="text-black text-sm font-extrabold">
                  Open Plan Builder
                </Text>
              </Pressable>
            </View>
          ) : (
            dayExercises.map((pe, idx) => {
              const activeEx = getActiveExercise(pe);
              const isSwapped = Boolean(swappedExerciseByPeId[pe.id]);
              const previewUri =
                activeEx.gif_url ?? activeEx.image_urls[0] ?? null;
              const rows = draftsByPeId[pe.id] ?? [];
              const suggestion = suggestionsByPeId[pe.id];
              const hasIncompleteWorking = rows.some(
                (r) => !r.is_completed && r.set_type !== "warmup"
              );

              return (
                <View
                  key={pe.id}
                  style={Shadows.card}
                  className="rounded-2xl bg-surface border border-border p-3.5 gap-3"
                >
                  {/* Exercise Card Header */}
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
                        <Text className="text-primary text-[11px] font-extrabold uppercase">
                          {idx + 1} of {dayExercises.length}
                        </Text>
                        {isSwapped && (
                          <View className="px-1.5 py-0.5 rounded bg-accent/20">
                            <Text className="text-accent text-[10px] font-bold">
                              Swapped
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
                          {activeEx.muscle_group} • {activeEx.equipment}
                        </Text>
                        <Text className="text-text-muted text-xs">
                          • {pe.target_sets}×{pe.target_reps} • {pe.rest_seconds}s
                        </Text>
                      </View>
                    </View>

                    <View className="flex-row items-center gap-1.5">
                      <Pressable
                        onPress={() => handleOpenSwapModal(pe)}
                        className="min-h-11 min-w-11 items-center justify-center rounded-xl bg-surface-elevated border border-border"
                      >
                        <Ionicons
                          name="swap-horizontal-outline"
                          size={20}
                          color={Colors.textPrimary}
                        />
                      </Pressable>
                      <Pressable
                        onPress={() => router.push(`/exercise/${activeEx.id}`)}
                        className="min-h-11 min-w-11 items-center justify-center rounded-xl bg-surface-elevated border border-border"
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
                            Smart Trainer • {suggestion.badge}
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
                        onPress={() => handleApplySuggestion(pe.id, suggestion)}
                        className="min-h-10 px-3.5 rounded-full bg-accent items-center justify-center"
                      >
                        <Text className="text-white text-xs font-extrabold">
                          Apply
                        </Text>
                      </Pressable>
                    </View>
                  )}

                  {/* Set Columns Header */}
                  <View className="flex-row items-center gap-2 px-2">
                    <Text className="w-11 text-center text-text-muted text-[11px] font-bold">
                      SET
                    </Text>
                    <Text className="flex-1 text-center text-text-muted text-[11px] font-bold">
                      PREVIOUS
                    </Text>
                    <Text className="w-16 text-center text-text-muted text-[11px] font-bold">
                      KG
                    </Text>
                    <Text className="w-14 text-center text-text-muted text-[11px] font-bold">
                      REPS
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
                        onCycleType={() => handleCycleSetType(pe, row)}
                        onCopyPrevious={() => handleCopyPrevious(pe.id, row)}
                        onChangeWeight={(val) =>
                          updateRow(pe.id, row.local_key, (r) => ({
                            ...r,
                            weight_kg: val,
                          }))
                        }
                        onChangeReps={(val) =>
                          updateRow(pe.id, row.local_key, (r) => ({
                            ...r,
                            reps: val,
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
                      className="flex-1 min-h-11 rounded-xl bg-surface-elevated border border-border items-center justify-center"
                    >
                      <Text className="text-text-primary text-xs font-bold">
                        + Add Set
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleRemoveSet(pe)}
                      disabled={rows.length <= 1}
                      className={`flex-1 min-h-11 rounded-xl bg-surface-elevated border border-border items-center justify-center ${
                        rows.length <= 1 ? "opacity-40" : ""
                      }`}
                    >
                      <Text className="text-text-secondary text-xs font-bold">
                        - Remove Set
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
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
                Machine Taken?
              </Text>
              <Text numberOfLines={1} className="text-text-primary text-base font-extrabold">
                Swap{" "}
                {swapTargetPe
                  ? getActiveExercise(swapTargetPe).name
                  : "Exercise"}
              </Text>
            </View>
            <Pressable
              onPress={() => setSwapTargetPe(null)}
              className="min-h-11 min-w-11 items-center justify-center px-2"
            >
              <Text className="text-primary text-base font-bold">Cancel</Text>
            </Pressable>
          </View>

          {loadingSwapCatalog ? (
            <View className="flex-1 items-center justify-center gap-3">
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text className="text-text-secondary text-sm">
                Finding same-muscle alternatives...
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
                    className="p-3 rounded-2xl bg-surface border border-border flex-row items-center gap-3"
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
                        {item.muscle_group} • {item.equipment}
                      </Text>
                    </View>
                    <View className="px-3 py-1.5 rounded-full bg-primary">
                      <Text className="text-black text-xs font-extrabold">
                        Swap
                      </Text>
                    </View>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <View className="py-12 items-center">
                  <Text className="text-text-secondary text-sm">
                    No alternative exercises found for this muscle group.
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
                Finish Workout?
              </Text>
              <Text className="text-text-secondary text-xs">
                {completedSetsCount}{" "}
                {completedSetsCount === 1 ? "set" : "sets"} logged for{" "}
                {selectedPlan.name}.
              </Text>
            </View>

            <TextInput
              value={sessionNotes}
              onChangeText={setSessionNotes}
              placeholder="Optional session notes (energy, PRs, pump)..."
              placeholderTextColor={Colors.textMuted}
              multiline
              className="bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-text-primary text-sm min-h-20"
            />

            <View className="flex-row gap-2.5">
              <Pressable
                onPress={() => setFinishModalVisible(false)}
                disabled={completing}
                className="flex-1 min-h-11 rounded-xl bg-surface-elevated border border-border items-center justify-center"
              >
                <Text className="text-text-secondary text-sm font-semibold">
                  Keep Lifting
                </Text>
              </Pressable>
              <Pressable
                onPress={handleFinishWorkout}
                disabled={completing}
                className="flex-1 min-h-11 rounded-xl bg-primary items-center justify-center"
              >
                <Text className="text-black text-sm font-extrabold">
                  {completing ? "Saving..." : "Complete Workout"}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
