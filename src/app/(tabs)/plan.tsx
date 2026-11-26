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
import { Colors, Shadows } from "@/constants/theme";
import {
  addExerciseToPlan,
  fetchWeeklyPlans,
  removePlanExercise,
  swapPlanExerciseOrder,
  updateDayPlanMeta,
  updatePlanExercise,
} from "@/lib/api";
import { CACHE_KEYS, saveCache } from "@/lib/offlineQueue";
import type {
  Exercise,
  PlanExerciseWithDetails,
  WorkoutPlan,
} from "@/types/database";

const WEEKDAYS = [
  { day: 1, letter: "M", full: "Monday" },
  { day: 2, letter: "T", full: "Tuesday" },
  { day: 3, letter: "W", full: "Wednesday" },
  { day: 4, letter: "T", full: "Thursday" },
  { day: 5, letter: "F", full: "Friday" },
  { day: 6, letter: "S", full: "Saturday" },
  { day: 7, letter: "S", full: "Sunday" },
] as const;

interface ExerciseEditorDraft {
  sets: string;
  reps: string;
  rest: string;
}

function getTodayIsoWeekday(): number {
  return ((new Date().getDay() + 6) % 7) + 1;
}

export default function PlanScreen() {
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [selectedDay, setSelectedDay] = useState<number>(getTodayIsoWeekday);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [nameDraft, setNameDraft] = useState("");
  const [isRestDayDraft, setIsRestDayDraft] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaSavedBanner, setMetaSavedBanner] = useState(false);

  const [exerciseDrafts, setExerciseDrafts] = useState<
    Record<string, ExerciseEditorDraft>
  >({});
  const [pickerVisible, setPickerVisible] = useState(false);

  const syncDraftsFromPlan = useCallback((plan: WorkoutPlan | null) => {
    if (!plan) return;
    setNameDraft(plan.name);
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

  const loadPlans = useCallback(async () => {
    try {
      const data = await fetchWeeklyPlans();
      setError(null);
      setPlans(data);
      const current = data.find((p) => p.day_of_week === selectedDay) ?? null;
      syncDraftsFromPlan(current);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load weekly split."
      );
    } finally {
      setLoading(false);
    }
  }, [selectedDay, syncDraftsFromPlan]);

  useFocusEffect(
    useCallback(() => {
      loadPlans();
    }, [loadPlans])
  );

  const selectedPlan = useMemo(
    () => plans.find((p) => p.day_of_week === selectedDay) ?? null,
    [plans, selectedDay]
  );

  function handleSelectDay(day: number) {
    setSelectedDay(day);
    const plan = plans.find((p) => p.day_of_week === day) ?? null;
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
    setPlans((prev) => {
      const next = updater(prev);
      saveCache(CACHE_KEYS.WEEKLY_PLANS, next);
      return next;
    });
  }

  async function handleSaveDayMeta() {
    if (!selectedPlan) return;
    const trimmedName = nameDraft.trim() || selectedPlan.name;
    const trimmedNotes = notesDraft.trim() || null;

    setSavingMeta(true);
    try {
      await updateDayPlanMeta(selectedPlan.id, {
        name: trimmedName,
        is_rest_day: isRestDayDraft,
        notes: trimmedNotes,
      });

      await updatePlansAndCache((prev) =>
        prev.map((p) =>
          p.id === selectedPlan.id
            ? {
                ...p,
                name: trimmedName,
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
        "Save Failed",
        err instanceof Error ? err.message : "Could not save day settings."
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
        "Add Failed",
        err instanceof Error ? err.message : "Could not add exercise to day."
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
        "Update Failed",
        err instanceof Error ? err.message : "Could not save exercise targets."
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
        "Reorder Failed",
        err instanceof Error ? err.message : "Could not reorder exercises."
      );
    }
  }

  function confirmRemoveExercise(pe: PlanExerciseWithDetails) {
    Alert.alert(
      "Remove Exercise",
      `Remove "${pe.exercise.name}" from ${
        WEEKDAYS.find((d) => d.day === selectedDay)?.full ?? "this day"
      }?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
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
                "Remove Failed",
                err instanceof Error
                  ? err.message
                  : "Could not remove exercise."
              );
            }
          },
        },
      ]
    );
  }

  const dayMeta = WEEKDAYS.find((d) => d.day === selectedDay) ?? WEEKDAYS[0];

  if (loading) {
    return (
      <SafeAreaView
        edges={["top"]}
        style={{ flex: 1, backgroundColor: Colors.background }}
      >
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text className="text-text-secondary text-sm">
            Loading weekly split...
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
            {error ?? "No weekly plan found. Make sure schema.sql was executed."}
          </Text>
          <Pressable
            onPress={loadPlans}
            className="min-h-11 px-5 rounded-xl bg-primary items-center justify-center"
          >
            <Text className="text-black text-sm font-extrabold">Retry</Text>
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
      {/* Editorial Header + SmartGym Circular Day Selector */}
      <View className="bg-surface border-b border-border px-4 pt-2 pb-3 gap-3">
        <View className="flex-row items-baseline justify-between">
          <Text className="text-text-primary text-2xl font-extrabold">
            Weekly Split
          </Text>
          <Text className="text-primary text-xs font-bold uppercase tracking-wider">
            {dayMeta.full}
          </Text>
        </View>

        <View className="flex-row items-center justify-between">
          {WEEKDAYS.map(({ day, letter }) => {
            const active = selectedDay === day;
            const planForDay = plans.find((p) => p.day_of_week === day);
            const hasWork =
              planForDay &&
              !planForDay.is_rest_day &&
              (planForDay.plan_exercises?.length ?? 0) > 0;

            return (
              <Pressable
                key={day}
                onPress={() => handleSelectDay(day)}
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
                Routine Details
              </Text>
              {metaSavedBanner && (
                <View className="px-2.5 py-1 rounded-full bg-primary-subtle border border-primary/40">
                  <Text className="text-primary text-xs font-bold">
                    Saved ✓
                  </Text>
                </View>
              )}
            </View>

            <View className="gap-1.5">
              <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider">
                Routine Name
              </Text>
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                placeholder="e.g., Push (Chest, Shoulders, Triceps)"
                placeholderTextColor={Colors.textMuted}
                className="bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-text-primary text-sm font-medium"
              />
            </View>

            <View className="flex-row items-center justify-between py-1">
              <View className="flex-1 pr-3">
                <Text className="text-text-primary text-sm font-semibold">
                  Rest Day
                </Text>
                <Text className="text-text-secondary text-xs">
                  Mark this day for active recovery &amp; mobility
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
                Day Notes / Cardio Finisher
              </Text>
              <TextInput
                value={notesDraft}
                onChangeText={setNotesDraft}
                placeholder="Optional cardio or focus notes..."
                placeholderTextColor={Colors.textMuted}
                multiline
                className="bg-surface-elevated border border-border rounded-xl px-3.5 py-2.5 text-text-primary text-sm min-h-16"
              />
            </View>

            <Pressable
              onPress={handleSaveDayMeta}
              disabled={savingMeta}
              className="min-h-11 rounded-xl bg-primary-subtle border border-primary/50 items-center justify-center"
            >
              <Text className="text-primary text-sm font-bold">
                {savingMeta ? "Saving..." : "Save Day Settings"}
              </Text>
            </Pressable>
          </View>

          {/* Assigned Exercises */}
          {!isRestDayDraft && (
            <View className="gap-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-text-primary text-base font-extrabold">
                  Exercises ({dayExercises.length})
                </Text>
                <Text className="text-text-secondary text-xs">
                  Targets auto-save on blur
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
                    No exercises assigned to {dayMeta.full} yet. Tap below to
                    add from the verified library.
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
                          className="flex-1 flex-row items-center gap-3"
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
                              Exercise {idx + 1}
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
                              {pe.exercise.muscle_group} •{" "}
                              {pe.exercise.equipment}
                            </Text>
                          </View>
                        </Pressable>

                        <View className="flex-row items-center gap-1">
                          <Pressable
                            onPress={() => handleMove(idx, -1)}
                            disabled={idx === 0}
                            className={`min-h-11 min-w-11 rounded-xl bg-surface-elevated border border-border items-center justify-center ${
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
                            className={`min-h-11 min-w-11 rounded-xl bg-surface-elevated border border-border items-center justify-center ${
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
                            className="min-h-11 min-w-11 rounded-xl bg-surface-elevated border border-border items-center justify-center"
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
                            Sets
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
                            Reps
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
                            className="min-h-11 bg-surface-elevated border border-border rounded-xl px-3 text-text-primary text-sm font-bold text-center"
                          />
                        </View>

                        <View className="flex-1 gap-1">
                          <Text className="text-text-secondary text-[11px] font-semibold">
                            Rest (s)
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
                className="min-h-12 rounded-2xl bg-primary flex-row items-center justify-center gap-2 mt-1"
              >
                <Ionicons name="add-circle" size={20} color="#000000" />
                <Text className="text-black text-sm font-extrabold">
                  Add Exercise to {dayMeta.full}
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
    </SafeAreaView>
  );
}
