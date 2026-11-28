import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ExercisePickerModal } from "@/components/ExercisePickerModal";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ProgramManagerModal } from "@/components/ProgramManagerModal";
import { Colors, Shadows } from "@/constants/theme";
import { formatTemplate, useI18n } from "@/i18n/LanguageContext";
import {
  addExerciseToPlan,
  addRoutineSlot,
  advanceProgramQueuePointer,
  deleteRoutineSlot,
  fetchPrograms,
  removePlanExercise,
  swapPlanExerciseOrder,
  updateDayPlanMeta,
  updatePlanExercise,
  updateProgramMeta,
} from "@/lib/api";
import { CACHE_KEYS, saveCache } from "@/lib/offlineQueue";
import { getRoutineShortLabel } from "@/lib/programTemplates";
import type {
  Exercise,
  PlanExerciseWithDetails,
  ScheduleMode,
  WorkoutPlan,
  WorkoutProgram,
} from "@/types/database";

interface ExerciseEditorDraft {
  sets: string;
  reps: string;
  rest: string;
}

function getTodayIsoWeekday(): number {
  return ((new Date().getDay() + 6) % 7) + 1;
}

export default function PlanScreen() {
  const { dict, tMuscle, tEquipment, weekdayList } = useI18n();
  const [programs, setPrograms] = useState<WorkoutProgram[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [nameDraft, setNameDraft] = useState("");
  const [shortLabelDraft, setShortLabelDraft] = useState("");
  const [isRestDayDraft, setIsRestDayDraft] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaSavedBanner, setMetaSavedBanner] = useState(false);

  const [exerciseDrafts, setExerciseDrafts] = useState<
    Record<string, ExerciseEditorDraft>
  >({});
  const [pickerVisible, setPickerVisible] = useState(false);
  const [programModalVisible, setProgramModalVisible] = useState(false);

  const syncDraftsFromPlan = useCallback((plan: WorkoutPlan | null) => {
    if (!plan) return;
    setNameDraft(plan.name);
    setShortLabelDraft(plan.short_label ?? "");
    setIsRestDayDraft(plan.is_rest_day);
    setNotesDraft(plan.notes ?? "");

    const drafts: Record<string, ExerciseEditorDraft> = {};
    for (const pe of plan.plan_exercises ?? []) {
      drafts[pe.id] = {
        sets: String(pe.target_sets),
        reps: pe.target_reps,
        rest: String(pe.rest_seconds),
      };
    }
    setExerciseDrafts(drafts);
  }, []);

  const activeProgram = useMemo(
    () => programs.find((p) => p.is_active) ?? programs[0] ?? null,
    [programs]
  );

  const plans = useMemo(
    () => activeProgram?.workout_plans ?? [],
    [activeProgram]
  );

  const selectedPlan = useMemo(() => {
    if (plans.length === 0) return null;
    if (selectedPlanId) {
      const found = plans.find((p) => p.id === selectedPlanId);
      if (found) return found;
    }
    if (activeProgram?.schedule_mode === "weekly") {
      return (
        plans.find((p) => p.day_of_week === getTodayIsoWeekday()) ?? plans[0]
      );
    }
    return (
      plans.find((p) => p.id === activeProgram?.next_routine_id) ??
      plans.find((p) => !p.is_rest_day) ??
      plans[0]
    );
  }, [plans, selectedPlanId, activeProgram]);

  const loadPlans = useCallback(async () => {
    try {
      const data = await fetchPrograms();
      setError(null);
      setPrograms(data);
      const act = data.find((p) => p.is_active) ?? data[0] ?? null;
      const list = act?.workout_plans ?? [];
      const current =
        (selectedPlanId && list.find((p) => p.id === selectedPlanId)) ||
        (act?.schedule_mode === "weekly"
          ? list.find((p) => p.day_of_week === getTodayIsoWeekday())
          : list.find((p) => p.id === act?.next_routine_id) ??
            list.find((p) => !p.is_rest_day)) ||
        list[0] ||
        null;
      if (current) {
        setSelectedPlanId(current.id);
        syncDraftsFromPlan(current);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.plan.loadError);
    } finally {
      setLoading(false);
    }
  }, [selectedPlanId, syncDraftsFromPlan, dict.plan.loadError]);

  useFocusEffect(
    useCallback(() => {
      loadPlans();
    }, [loadPlans])
  );

  function handleSelectPlan(plan: WorkoutPlan | null) {
    if (!plan) return;
    setSelectedPlanId(plan.id);
    syncDraftsFromPlan(plan);
  }

  const existingExerciseIds = useMemo(
    () =>
      new Set((selectedPlan?.plan_exercises ?? []).map((pe) => pe.exercise_id)),
    [selectedPlan]
  );

  async function updatePlansAndCache(
    updater: (prev: WorkoutPlan[]) => WorkoutPlan[]
  ) {
    setPrograms((prevPrograms) => {
      const targetId = activeProgram?.id ?? prevPrograms[0]?.id;
      const nextPrograms = prevPrograms.map((prog) =>
        prog.id === targetId
          ? { ...prog, workout_plans: updater(prog.workout_plans ?? []) }
          : prog
      );
      saveCache(CACHE_KEYS.PROGRAMS, nextPrograms);
      const updatedActive = nextPrograms.find((p) => p.id === targetId);
      if (updatedActive?.workout_plans) {
        saveCache(CACHE_KEYS.WEEKLY_PLANS, updatedActive.workout_plans);
      }
      return nextPrograms;
    });
  }

  async function handleSwitchProgramMode(nextMode: ScheduleMode) {
    if (!activeProgram || activeProgram.schedule_mode === nextMode) return;
    try {
      await updateProgramMeta(activeProgram.id, { schedule_mode: nextMode });
      const fresh = await fetchPrograms();
      setPrograms(fresh);
      const nextActive = fresh.find((p) => p.id === activeProgram.id) ?? fresh[0];
      const nextList = nextActive?.workout_plans ?? [];
      const fallback = nextList[0] ?? null;
      if (fallback) {
        setSelectedPlanId(fallback.id);
        syncDraftsFromPlan(fallback);
      }
    } catch (err) {
      Alert.alert(
        dict.plan.saveFailedTitle,
        err instanceof Error ? err.message : dict.plan.saveFailedBody
      );
    }
  }

  async function handleSetUpNextInQueue() {
    if (!activeProgram || !selectedPlan) return;
    try {
      await advanceProgramQueuePointer(activeProgram.id, selectedPlan.id);
      const nextPrograms = programs.map((prog) =>
        prog.id === activeProgram.id
          ? { ...prog, next_routine_id: selectedPlan.id }
          : prog
      );
      setPrograms(nextPrograms);
      await saveCache(CACHE_KEYS.PROGRAMS, nextPrograms);
    } catch (err) {
      Alert.alert(
        dict.plan.saveFailedTitle,
        err instanceof Error ? err.message : dict.plan.saveFailedBody
      );
    }
  }

  async function handleAddRoutineSlot() {
    if (!activeProgram) return;
    const nextNum = plans.length + 1;
    const maxOrder = plans.reduce((m, p) => Math.max(m, p.order_index), -1);
    const defaultName = formatTemplate(dict.plan.newRoutineDefault, {
      num: nextNum,
    });
    const defaultShort = `R${nextNum}`;
    try {
      const added = await addRoutineSlot(activeProgram.id, {
        name: defaultName,
        short_label: defaultShort,
        order_index: maxOrder + 1,
      });
      await updatePlansAndCache((prev) => [...prev, added]);
      setSelectedPlanId(added.id);
      syncDraftsFromPlan(added);
    } catch (err) {
      Alert.alert(
        dict.plan.addFailedTitle,
        err instanceof Error ? err.message : dict.plan.addFailedBody
      );
    }
  }

  function confirmDeleteRoutine() {
    if (!activeProgram || !selectedPlan || plans.length <= 1) return;
    Alert.alert(
      dict.plan.deleteRoutineBtn,
      formatTemplate(dict.plan.deleteRoutineConfirm, {
        name: selectedPlan.name,
      }),
      [
        { text: dict.common.cancel, style: "cancel" },
        {
          text: dict.common.delete,
          style: "destructive",
          onPress: async () => {
            try {
              await deleteRoutineSlot(selectedPlan.id);
              const remaining = plans.filter((p) => p.id !== selectedPlan.id);
              let nextPointer = activeProgram.next_routine_id;
              if (nextPointer === selectedPlan.id) {
                const candidate =
                  remaining.find((r) => !r.is_rest_day) ?? remaining[0] ?? null;
                nextPointer = candidate?.id ?? null;
                await advanceProgramQueuePointer(activeProgram.id, nextPointer);
              }
              const nextPrograms = programs.map((prog) =>
                prog.id === activeProgram.id
                  ? {
                      ...prog,
                      next_routine_id: nextPointer,
                      workout_plans: remaining,
                    }
                  : prog
              );
              setPrograms(nextPrograms);
              await saveCache(CACHE_KEYS.PROGRAMS, nextPrograms);
              const nextFocus = remaining[0] ?? null;
              if (nextFocus) {
                setSelectedPlanId(nextFocus.id);
                syncDraftsFromPlan(nextFocus);
              }
            } catch (err) {
              Alert.alert(
                dict.plan.removeFailedTitle,
                err instanceof Error
                  ? err.message
                  : dict.plan.removeFailedBody
              );
            }
          },
        },
      ]
    );
  }

  async function handleSaveDayMeta() {
    if (!selectedPlan) return;
    const trimmedName = nameDraft.trim() || selectedPlan.name;
    const trimmedShort =
      shortLabelDraft.trim().slice(0, 10).toUpperCase() || null;
    const trimmedNotes = notesDraft.trim() || null;

    setSavingMeta(true);
    try {
      await updateDayPlanMeta(selectedPlan.id, {
        name: trimmedName,
        short_label: trimmedShort,
        is_rest_day: isRestDayDraft,
        notes: trimmedNotes,
      });

      await updatePlansAndCache((prev) =>
        prev.map((p) =>
          p.id === selectedPlan.id
            ? {
                ...p,
                name: trimmedName,
                short_label: trimmedShort,
                is_rest_day: isRestDayDraft,
                notes: trimmedNotes,
              }
            : p
        )
      );

      setMetaSavedBanner(true);
      setTimeout(() => setMetaSavedBanner(false), 2000);
    } catch (err) {
      Alert.alert(
        dict.plan.saveFailedTitle,
        err instanceof Error ? err.message : dict.plan.saveFailedBody
      );
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleAddExercise(exercise: Exercise) {
    if (!selectedPlan) return;
    const currentList = selectedPlan.plan_exercises ?? [];
    const maxOrder = currentList.reduce(
      (max, item) => Math.max(max, item.order_index),
      -1
    );

    try {
      const added = await addExerciseToPlan(
        selectedPlan.id,
        exercise.id,
        maxOrder + 1
      );
      setExerciseDrafts((prev) => ({
        ...prev,
        [added.id]: {
          sets: String(added.target_sets),
          reps: added.target_reps,
          rest: String(added.rest_seconds),
        },
      }));
      await updatePlansAndCache((prev) =>
        prev.map((p) =>
          p.id === selectedPlan.id
            ? { ...p, plan_exercises: [...(p.plan_exercises ?? []), added] }
            : p
        )
      );
    } catch (err) {
      Alert.alert(
        dict.plan.addFailedTitle,
        err instanceof Error ? err.message : dict.plan.addFailedBody
      );
    }
  }

  async function handlePersistExerciseTargets(pe: PlanExerciseWithDetails) {
    const draft = exerciseDrafts[pe.id];
    if (!draft) return;

    const parsedSets = Math.max(1, parseInt(draft.sets, 10) || pe.target_sets);
    const parsedReps = draft.reps.trim() || pe.target_reps;
    const parsedRest = Math.max(
      0,
      parseInt(draft.rest, 10) || (draft.rest === "0" ? 0 : pe.rest_seconds)
    );

    setExerciseDrafts((prev) => ({
      ...prev,
      [pe.id]: {
        sets: String(parsedSets),
        reps: parsedReps,
        rest: String(parsedRest),
      },
    }));

    if (
      parsedSets === pe.target_sets &&
      parsedReps === pe.target_reps &&
      parsedRest === pe.rest_seconds
    ) {
      return;
    }

    try {
      await updatePlanExercise(pe.id, {
        target_sets: parsedSets,
        target_reps: parsedReps,
        rest_seconds: parsedRest,
      });

      await updatePlansAndCache((prev) =>
        prev.map((p) =>
          p.id === pe.plan_id
            ? {
                ...p,
                plan_exercises: (p.plan_exercises ?? []).map((item) =>
                  item.id === pe.id
                    ? {
                        ...item,
                        target_sets: parsedSets,
                        target_reps: parsedReps,
                        rest_seconds: parsedRest,
                      }
                    : item
                ),
              }
            : p
        )
      );
    } catch (err) {
      Alert.alert(
        dict.plan.updateFailedTitle,
        err instanceof Error ? err.message : dict.plan.updateFailedBody
      );
    }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    if (!selectedPlan) return;
    const list = selectedPlan.plan_exercises ?? [];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= list.length) return;

    const currentItem = list[index];
    const swapItem = list[targetIndex];
    const orderA = currentItem.order_index;
    const orderB =
      swapItem.order_index === orderA ? orderA + direction : swapItem.order_index;

    try {
      await swapPlanExerciseOrder(
        { ...currentItem, order_index: orderA },
        { ...swapItem, order_index: orderB }
      );

      const nextList = [...list];
      nextList[index] = { ...swapItem, order_index: orderA };
      nextList[targetIndex] = { ...currentItem, order_index: orderB };

      await updatePlansAndCache((prev) =>
        prev.map((p) =>
          p.id === selectedPlan.id ? { ...p, plan_exercises: nextList } : p
        )
      );
    } catch (err) {
      Alert.alert(
        dict.plan.reorderFailedTitle,
        err instanceof Error ? err.message : dict.plan.reorderFailedBody
      );
    }
  }

  function confirmRemoveExercise(pe: PlanExerciseWithDetails) {
    const contextName =
      activeProgram?.schedule_mode === "weekly" && selectedPlan?.day_of_week
        ? weekdayList.find((d) => d.day === selectedPlan.day_of_week)?.full ??
          selectedPlan.name
        : selectedPlan?.name ?? dict.plan.routineFallbackLabel;

    Alert.alert(
      dict.plan.removeTitle,
      formatTemplate(dict.plan.removeConfirm, {
        name: pe.exercise.name,
        day: contextName,
      }),
      [
        { text: dict.common.cancel, style: "cancel" },
        {
          text: dict.common.delete,
          style: "destructive",
          onPress: async () => {
            try {
              await removePlanExercise(pe.id);
              await updatePlansAndCache((prev) =>
                prev.map((p) =>
                  p.id === pe.plan_id
                    ? {
                        ...p,
                        plan_exercises: (p.plan_exercises ?? []).filter(
                          (item) => item.id !== pe.id
                        ),
                      }
                    : p
                )
              );
            } catch (err) {
              Alert.alert(
                dict.plan.removeFailedTitle,
                err instanceof Error
                  ? err.message
                  : dict.plan.removeFailedBody
              );
            }
          },
        },
      ]
    );
  }

  const isRolling = activeProgram?.schedule_mode === "rolling";
  const activeWeekday = selectedPlan?.day_of_week ?? getTodayIsoWeekday();
  const dayMeta =
    weekdayList.find((d) => d.day === activeWeekday) ?? weekdayList[0];
  const selectedContextLabel = isRolling
    ? selectedPlan?.name ?? dict.plan.routineFallbackLabel
    : dayMeta.full;

  if (loading) {
    return (
      <SafeAreaView
        edges={["top"]}
        style={{ flex: 1, backgroundColor: Colors.background }}
      >
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text className="text-text-secondary text-sm">
            {dict.plan.loading}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !selectedPlan || !activeProgram) {
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
            {error ?? dict.plan.loadError}
          </Text>
          <Pressable
            onPress={loadPlans}
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

  const dayExercises = selectedPlan.plan_exercises ?? [];

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: Colors.background }}
    >
      {/* Editorial Header + Program / Schedule Switcher */}
      <View className="bg-surface border-b border-border px-4 pt-2 pb-3 gap-3">
        <View className="flex-row items-center justify-between gap-2">
          <View className="flex-1">
            <Text className="text-primary text-[11px] font-extrabold uppercase tracking-wider">
              {activeProgram.name}
            </Text>
            <Text className="text-text-primary text-2xl font-extrabold">
              {dict.plan.title}
            </Text>
          </View>
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={() => setProgramModalVisible(true)}
              accessibilityRole="button"
              className="min-h-11 px-3.5 rounded-full bg-surface-elevated border border-border flex-row items-center gap-1.5 active:opacity-75"
            >
              <Ionicons
                name="layers-outline"
                size={15}
                color={Colors.primary}
              />
              <Text className="text-text-primary text-xs font-bold">
                {dict.plan.programsBtn}
              </Text>
            </Pressable>
            <LanguageToggle />
          </View>
        </View>

        {/* Rolling Queue vs Fixed Weekdays Segmented Switcher */}
        <View className="flex-row bg-surface-elevated rounded-xl p-1 border border-border">
          {(["rolling", "weekly"] as const).map((mode) => {
            const active = activeProgram.schedule_mode === mode;
            return (
              <Pressable
                key={mode}
                onPress={() => handleSwitchProgramMode(mode)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                className={`flex-1 min-h-11 rounded-lg flex-row items-center justify-center gap-1.5 active:opacity-75 ${
                  active ? "bg-primary" : ""
                }`}
              >
                <Ionicons
                  name={mode === "rolling" ? "repeat" : "calendar-outline"}
                  size={14}
                  color={active ? "#000000" : Colors.textSecondary}
                />
                <Text
                  className={`text-xs font-extrabold ${
                    active ? "text-black" : "text-text-secondary"
                  }`}
                >
                  {mode === "rolling"
                    ? dict.plan.rollingMode
                    : dict.plan.weeklyMode}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {isRolling ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingRight: 8 }}
          >
            {plans.map((routine, idx) => {
              const active = selectedPlan.id === routine.id;
              const isUpNext = activeProgram.next_routine_id === routine.id;
              const shortText = getRoutineShortLabel(
                routine,
                idx,
                dict.workout.restChip
              );
              return (
                <Pressable
                  key={routine.id}
                  onPress={() => handleSelectPlan(routine)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className={`min-h-11 px-3.5 rounded-full border flex-row items-center gap-1.5 active:opacity-75 ${
                    active
                      ? "bg-primary border-primary"
                      : "bg-surface-elevated border-border"
                  }`}
                >
                  <Text
                    style={{ fontVariant: ["tabular-nums"] }}
                    className={`text-xs font-extrabold ${
                      active ? "text-black" : "text-text-primary"
                    }`}
                  >
                    {idx + 1} • {shortText}
                  </Text>
                  {isUpNext && (
                    <View
                      className={`w-2 h-2 rounded-full ${
                        active ? "bg-black" : "bg-primary"
                      }`}
                    />
                  )}
                </Pressable>
              );
            })}

            <Pressable
              onPress={handleAddRoutineSlot}
              accessibilityRole="button"
              className="min-h-11 px-3.5 rounded-full border border-dashed border-primary/70 bg-primary-subtle flex-row items-center justify-center active:opacity-75"
            >
              <Text className="text-primary text-xs font-extrabold">
                {dict.plan.addRoutineBtn}
              </Text>
            </Pressable>
          </ScrollView>
        ) : (
          <View className="flex-row items-center justify-between">
            {weekdayList.map(({ day, letter }) => {
              const planForDay = plans.find((p) => p.day_of_week === day);
              const active = Boolean(
                planForDay && selectedPlan.id === planForDay.id
              );
              const hasWork =
                planForDay &&
                !planForDay.is_rest_day &&
                (planForDay.plan_exercises?.length ?? 0) > 0;

              return (
                <Pressable
                  key={day}
                  onPress={() => handleSelectPlan(planForDay ?? null)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className="min-h-11 min-w-11 items-center justify-center gap-1 active:opacity-75"
                >
                  <View
                    className={`w-10 h-10 rounded-full border items-center justify-center ${
                      active
                        ? "bg-primary border-primary"
                        : "bg-surface-elevated border-border"
                    }`}
                  >
                    <Text
                      className={`${
                        letter.length > 1 ? "text-xs" : "text-sm"
                      } font-extrabold ${
                        active ? "text-black" : "text-text-secondary"
                      }`}
                    >
                      {letter}
                    </Text>
                  </View>
                  <View
                    className={`w-1.5 h-1.5 rounded-full ${
                      planForDay?.is_rest_day
                        ? "bg-text-muted"
                        : hasWork
                          ? "bg-primary"
                          : "bg-transparent"
                    }`}
                  />
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Routine Details Card */}
          <View
            style={Shadows.card}
            className="rounded-2xl bg-surface border border-border p-4 gap-3"
          >
            <View className="flex-row items-center justify-between">
              <Text className="text-text-primary text-base font-extrabold">
                {dict.plan.routineDetails}
              </Text>
              {metaSavedBanner && (
                <View className="px-2.5 py-1 rounded-full bg-primary-subtle border border-primary/40">
                  <Text className="text-primary text-xs font-bold">
                    {dict.plan.savedBadge}
                  </Text>
                </View>
              )}
            </View>

            <View className="gap-1.5">
              <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider">
                {dict.plan.routineNameLabel}
              </Text>
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                placeholder={dict.plan.routineNamePlaceholder}
                placeholderTextColor={Colors.textMuted}
                className="bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-text-primary text-sm font-medium"
              />
            </View>

            <View className="gap-1.5">
              <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider">
                {dict.plan.shortTagLabel}
              </Text>
              <TextInput
                value={shortLabelDraft}
                onChangeText={setShortLabelDraft}
                maxLength={12}
                autoCapitalize="characters"
                placeholder={dict.plan.shortTagPlaceholder}
                placeholderTextColor={Colors.textMuted}
                className="bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-text-primary text-sm font-bold"
              />
            </View>

            <View className="flex-row items-center justify-between py-1">
              <View className="flex-1 pr-3">
                <Text className="text-text-primary text-sm font-semibold">
                  {dict.plan.restDayLabel}
                </Text>
                <Text className="text-text-secondary text-xs">
                  {dict.plan.restDaySubtitle}
                </Text>
              </View>
              <Switch
                value={isRestDayDraft}
                onValueChange={setIsRestDayDraft}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor="#FFFFFF"
              />
            </View>

            <View className="gap-1.5">
              <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider">
                {dict.plan.notesLabel}
              </Text>
              <TextInput
                value={notesDraft}
                onChangeText={setNotesDraft}
                placeholder={dict.plan.notesPlaceholder}
                placeholderTextColor={Colors.textMuted}
                multiline
                className="bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-text-primary text-sm min-h-16"
              />
            </View>

            <Pressable
              onPress={handleSaveDayMeta}
              disabled={savingMeta}
              accessibilityRole="button"
              className="min-h-11 rounded-xl bg-primary-subtle border border-primary/50 items-center justify-center active:opacity-75"
            >
              <Text className="text-primary text-sm font-bold">
                {savingMeta ? dict.common.saving : dict.plan.saveSettings}
              </Text>
            </Pressable>

            {isRolling && (
              <View className="flex-row gap-2">
                {!isRestDayDraft && (
                  <Pressable
                    onPress={handleSetUpNextInQueue}
                    disabled={activeProgram.next_routine_id === selectedPlan.id}
                    accessibilityRole="button"
                    className={`flex-1 min-h-11 rounded-xl border items-center justify-center active:opacity-75 ${
                      activeProgram.next_routine_id === selectedPlan.id
                        ? "bg-primary border-primary"
                        : "bg-surface-elevated border-border"
                    }`}
                  >
                    <Text
                      className={`text-xs font-extrabold ${
                        activeProgram.next_routine_id === selectedPlan.id
                          ? "text-black"
                          : "text-text-primary"
                      }`}
                    >
                      {activeProgram.next_routine_id === selectedPlan.id
                        ? dict.plan.isUpNextBadge
                        : dict.plan.setAsUpNextBtn}
                    </Text>
                  </Pressable>
                )}

                {plans.length > 1 && (
                  <Pressable
                    onPress={confirmDeleteRoutine}
                    accessibilityRole="button"
                    className="min-h-11 px-3.5 rounded-xl bg-surface-elevated border border-border items-center justify-center active:opacity-75"
                  >
                    <Text className="text-danger text-xs font-bold">
                      {dict.plan.deleteRoutineBtn}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>

          {/* Assigned Exercises */}
          {!isRestDayDraft && (
            <View className="gap-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-text-primary text-base font-extrabold">
                  {dict.plan.exercisesHeading} ({dayExercises.length})
                </Text>
                <Text className="text-text-secondary text-xs">
                  {dict.plan.autoSaveHint}
                </Text>
              </View>

              {dayExercises.length === 0 ? (
                <View className="rounded-2xl bg-surface border border-border p-6 items-center gap-2">
                  <Ionicons
                    name="barbell-outline"
                    size={28}
                    color={Colors.textMuted}
                  />
                  <Text className="text-text-secondary text-sm text-center">
                    {formatTemplate(dict.plan.emptyDay, {
                      day: selectedContextLabel,
                    })}
                  </Text>
                </View>
              ) : (
                dayExercises.map((pe, idx) => {
                  const previewUri =
                    pe.exercise.gif_url ?? pe.exercise.image_urls[0] ?? null;
                  const draft = exerciseDrafts[pe.id] ?? {
                    sets: String(pe.target_sets),
                    reps: pe.target_reps,
                    rest: String(pe.rest_seconds),
                  };

                  return (
                    <View
                      key={pe.id}
                      style={Shadows.card}
                      className="rounded-2xl bg-surface border border-border p-3.5 gap-3"
                    >
                      <View className="flex-row items-center gap-3">
                        <Pressable
                          onPress={() =>
                            router.push(`/exercise/${pe.exercise_id}`)
                          }
                          accessibilityRole="button"
                          className="flex-1 flex-row items-center gap-3 active:opacity-75"
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
                            <Text className="text-primary text-[11px] font-bold uppercase">
                              {dict.plan.exercisePrefix} {idx + 1}
                            </Text>
                            <Text
                              numberOfLines={1}
                              className="text-text-primary text-sm font-bold"
                            >
                              {pe.exercise.name}
                            </Text>
                            <Text
                              numberOfLines={1}
                              className="text-text-secondary text-xs mt-0.5"
                            >
                              {tMuscle(pe.exercise.muscle_group)} •{" "}
                              {tEquipment(pe.exercise.equipment)}
                            </Text>
                          </View>
                        </Pressable>

                        <View className="flex-row items-center gap-2">
                          <Pressable
                            onPress={() => handleMove(idx, -1)}
                            disabled={idx === 0}
                            accessibilityRole="button"
                            accessibilityLabel={`Move ${pe.exercise.name} up`}
                            accessibilityState={{ disabled: idx === 0 }}
                            className={`min-h-11 min-w-11 rounded-xl bg-surface-elevated border border-border items-center justify-center active:opacity-75 ${
                              idx === 0 ? "opacity-35" : ""
                            }`}
                          >
                            <Ionicons
                              name="arrow-up"
                              size={18}
                              color={Colors.textPrimary}
                            />
                          </Pressable>
                          <Pressable
                            onPress={() => handleMove(idx, 1)}
                            disabled={idx === dayExercises.length - 1}
                            accessibilityRole="button"
                            accessibilityLabel={`Move ${pe.exercise.name} down`}
                            accessibilityState={{
                              disabled: idx === dayExercises.length - 1,
                            }}
                            className={`min-h-11 min-w-11 rounded-xl bg-surface-elevated border border-border items-center justify-center active:opacity-75 ${
                              idx === dayExercises.length - 1
                                ? "opacity-35"
                                : ""
                            }`}
                          >
                            <Ionicons
                              name="arrow-down"
                              size={18}
                              color={Colors.textPrimary}
                            />
                          </Pressable>
                          <Pressable
                            onPress={() => confirmRemoveExercise(pe)}
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${pe.exercise.name}`}
                            className="min-h-11 min-w-11 rounded-xl bg-surface-elevated border border-border items-center justify-center active:opacity-75"
                          >
                            <Ionicons
                              name="trash-outline"
                              size={18}
                              color={Colors.danger}
                            />
                          </Pressable>
                        </View>
                      </View>

                      <View className="flex-row gap-2.5">
                        <View className="flex-1 gap-1">
                          <Text className="text-text-secondary text-[11px] font-semibold">
                            {dict.plan.setsLabel}
                          </Text>
                          <TextInput
                            value={draft.sets}
                            onChangeText={(val) =>
                              setExerciseDrafts((prev) => ({
                                ...prev,
                                [pe.id]: {
                                  ...draft,
                                  sets: val.replace(/[^0-9]/g, ""),
                                },
                              }))
                            }
                            onBlur={() => handlePersistExerciseTargets(pe)}
                            keyboardType="number-pad"
                            style={{ fontVariant: ["tabular-nums"] }}
                            className="min-h-11 bg-surface-elevated border border-border rounded-xl px-3 text-text-primary text-sm font-bold text-center"
                          />
                        </View>

                        <View className="flex-1 gap-1">
                          <Text className="text-text-secondary text-[11px] font-semibold">
                            {dict.plan.repsLabel}
                          </Text>
                          <TextInput
                            value={draft.reps}
                            onChangeText={(val) =>
                              setExerciseDrafts((prev) => ({
                                ...prev,
                                [pe.id]: { ...draft, reps: val },
                              }))
                            }
                            onBlur={() => handlePersistExerciseTargets(pe)}
                            placeholder="8-12"
                            placeholderTextColor={Colors.textMuted}
                            style={{ fontVariant: ["tabular-nums"] }}
                            className="min-h-11 bg-surface-elevated border border-border rounded-xl px-3 text-text-primary text-sm font-bold text-center"
                          />
                        </View>

                        <View className="flex-1 gap-1">
                          <Text className="text-text-secondary text-[11px] font-semibold">
                            {dict.plan.restLabel}
                          </Text>
                          <TextInput
                            value={draft.rest}
                            onChangeText={(val) =>
                              setExerciseDrafts((prev) => ({
                                ...prev,
                                [pe.id]: {
                                  ...draft,
                                  rest: val.replace(/[^0-9]/g, ""),
                                },
                              }))
                            }
                            onBlur={() => handlePersistExerciseTargets(pe)}
                            keyboardType="number-pad"
                            style={{ fontVariant: ["tabular-nums"] }}
                            className="min-h-11 bg-surface-elevated border border-border rounded-xl px-3 text-text-primary text-sm font-bold text-center"
                          />
                        </View>
                      </View>
                    </View>
                  );
                })
              )}

              <Pressable
                onPress={() => setPickerVisible(true)}
                style={Shadows.card}
                accessibilityRole="button"
                className="min-h-12 rounded-2xl bg-primary flex-row items-center justify-center gap-2 mt-1 active:opacity-75"
              >
                <Ionicons name="add-circle" size={20} color="#000000" />
                <Text className="text-black text-sm font-extrabold">
                  {formatTemplate(dict.plan.addExerciseBtn, {
                    day: selectedContextLabel,
                  })}
                </Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <ExercisePickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={handleAddExercise}
        existingExerciseIds={existingExerciseIds}
      />

      <ProgramManagerModal
        visible={programModalVisible}
        programs={programs}
        onClose={() => setProgramModalVisible(false)}
        onProgramsChanged={(updated) => {
          setPrograms(updated);
          const nextAct = updated.find((p) => p.is_active) ?? updated[0] ?? null;
          const nextList = nextAct?.workout_plans ?? [];
          const nextFocus =
            nextList.find((r) => r.id === nextAct?.next_routine_id) ??
            nextList.find((r) => !r.is_rest_day) ??
            nextList[0] ??
            null;
          if (nextFocus) {
            setSelectedPlanId(nextFocus.id);
            syncDraftsFromPlan(nextFocus);
          }
        }}
      />
    </SafeAreaView>
  );
}
