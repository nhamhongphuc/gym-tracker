import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LanguageToggle } from "@/components/LanguageToggle";
import { MuscleBodyMap } from "@/components/MuscleBodyMap";
import { Colors, Shadows } from "@/constants/theme";
import { formatTemplate, useI18n } from "@/i18n/LanguageContext";
import {
  deleteWorkoutSession,
  fetchWorkoutHistory,
  getLocalDateString,
} from "@/lib/api";
import { computeMuscleAnalytics } from "@/lib/smartCoach";
import type { SetLog, WorkoutSession } from "@/types/database";

type HistorySegment = "overview" | "muscles";

function getCurrentWeekBounds(): { monday: string; sunday: string } {
  const now = new Date();
  const isoDay = ((now.getDay() + 6) % 7) + 1;
  const monDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (isoDay - 1)
  );
  const sunDate = new Date(
    monDate.getFullYear(),
    monDate.getMonth(),
    monDate.getDate() + 6
  );
  return {
    monday: getLocalDateString(monDate),
    sunday: getLocalDateString(sunDate),
  };
}

function getCurrentMonthPrefix(locale: "en" | "vi"): {
  prefix: string;
  label: string;
} {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const label = now.toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US", {
    month: "long",
    year: "numeric",
  });
  return { prefix: `${year}-${month}`, label };
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "—";
  const diffMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return "—";
  const mins = Math.max(1, Math.round(diffMs / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

function groupLogsByExercise(
  logs: NonNullable<WorkoutSession["set_logs"]>
): { exerciseId: string; name: string; sets: SetLog[] }[] {
  const map = new Map<
    string,
    { exerciseId: string; name: string; sets: SetLog[] }
  >();

  for (const log of logs) {
    if (!log.is_completed) continue;
    let group = map.get(log.exercise_id);
    if (!group) {
      group = {
        exerciseId: log.exercise_id,
        name: log.exercise?.name ?? "Exercise",
        sets: [],
      };
      map.set(log.exercise_id, group);
    }
    group.sets.push(log);
  }

  return Array.from(map.values());
}

export default function HistoryScreen() {
  const { locale, dict, tMuscle } = useI18n();
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [segment, setSegment] = useState<HistorySegment>("overview");
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);
  const [analyticsNowMs, setAnalyticsNowMs] = useState(() => Date.now());

  const loadHistory = useCallback(async () => {
    try {
      const data = await fetchWorkoutHistory(60);
      setError(null);
      setSessions(data);
      setAnalyticsNowMs(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.history.loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dict.history.loadError]);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory])
  );

  const { prefix: monthPrefix, label: monthLabel } = useMemo(
    () => getCurrentMonthPrefix(locale),
    [locale]
  );

  const heroStats = useMemo(() => {
    const { monday, sunday } = getCurrentWeekBounds();
    let monthWorkouts = 0;
    let monthVolumeKg = 0;
    let weekSets = 0;
    let weekVolumeKg = 0;

    for (const session of sessions) {
      const inMonth = session.session_date.startsWith(monthPrefix);
      const inWeek =
        session.session_date >= monday && session.session_date <= sunday;

      if (inMonth) monthWorkouts++;

      for (const log of session.set_logs ?? []) {
        if (!log.is_completed) continue;
        const vol = log.weight_kg * log.reps;
        if (inMonth) monthVolumeKg += vol;
        if (inWeek) {
          weekSets++;
          weekVolumeKg += vol;
        }
      }
    }

    return {
      monthWorkouts,
      monthVolumeKg: Math.round(monthVolumeKg),
      weekSets,
      weekVolumeKg: Math.round(weekVolumeKg),
    };
  }, [sessions, monthPrefix]);

  const dailyBars = useMemo(() => {
    const volumeByDate = new Map<string, number>();
    for (const session of sessions) {
      const sessionVol = (session.set_logs ?? []).reduce(
        (sum, l) => (l.is_completed ? sum + l.weight_kg * l.reps : sum),
        0
      );
      volumeByDate.set(
        session.session_date,
        (volumeByDate.get(session.session_date) ?? 0) + sessionVol
      );
    }

    const base = new Date(analyticsNowMs);
    const days: { dateStr: string; dayNum: string; volume: number }[] = [];
    for (let offset = 13; offset >= 0; offset--) {
      const d = new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate() - offset
      );
      const dateStr = getLocalDateString(d);
      days.push({
        dateStr,
        dayNum: String(d.getDate()),
        volume: volumeByDate.get(dateStr) ?? 0,
      });
    }

    const maxVol = Math.max(1, ...days.map((d) => d.volume));
    return days.map((d) => ({
      ...d,
      heightPct:
        d.volume > 0 ? Math.max(14, Math.round((d.volume / maxVol) * 100)) : 6,
    }));
  }, [sessions, analyticsNowMs]);

  const muscleSummaries = useMemo(
    () => computeMuscleAnalytics(sessions, analyticsNowMs),
    [sessions, analyticsNowMs]
  );

  const muscleList = useMemo(() => {
    const entries = Object.values(muscleSummaries).sort(
      (a, b) => b.setsCount - a.setsCount
    );
    if (!selectedMuscle) return entries;
    return entries.filter((e) => e.muscleGroup === selectedMuscle);
  }, [muscleSummaries, selectedMuscle]);

  function confirmDeleteSession(session: WorkoutSession) {
    Alert.alert(
      dict.history.deleteTitle,
      formatTemplate(dict.history.deleteConfirm, {
        name: session.plan_name_snapshot,
        date: session.session_date,
      }),
      [
        { text: dict.common.cancel, style: "cancel" },
        {
          text: dict.common.delete,
          style: "destructive",
          onPress: async () => {
            try {
              await deleteWorkoutSession(session.id);
              setSessions((prev) => prev.filter((s) => s.id !== session.id));
            } catch (err) {
              Alert.alert(
                dict.history.deleteFailedTitle,
                err instanceof Error
                  ? err.message
                  : dict.history.deleteFailedBody
              );
            }
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: Colors.background }}
    >
      {/* Editorial Header + Overview / Muscles Segmented Switcher */}
      <View className="px-4 pt-2 pb-3 bg-surface border-b border-border gap-3">
        <View className="flex-row items-center justify-between gap-2">
          <View className="flex-1">
            <Text className="text-text-secondary text-xs font-semibold">
              {sessions.length} {dict.history.totalLogsSuffix}
            </Text>
            <Text
              numberOfLines={1}
              className="text-text-primary text-2xl font-extrabold"
            >
              {segment === "overview" ? monthLabel : dict.history.musclesTitle}
            </Text>
          </View>
          <LanguageToggle />
        </View>

        <View className="flex-row p-1 rounded-xl bg-background border border-border">
          <Pressable
            onPress={() => setSegment("overview")}
            className={`flex-1 min-h-10 rounded-lg items-center justify-center ${
              segment === "overview" ? "bg-primary" : ""
            }`}
          >
            <Text
              className={`text-xs font-extrabold ${
                segment === "overview" ? "text-black" : "text-text-secondary"
              }`}
            >
              {dict.history.overviewTab}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSegment("muscles")}
            className={`flex-1 min-h-10 rounded-lg items-center justify-center ${
              segment === "muscles" ? "bg-primary" : ""
            }`}
          >
            <Text
              className={`text-xs font-extrabold ${
                segment === "muscles" ? "text-black" : "text-text-secondary"
              }`}
            >
              {dict.history.musclesTab}
            </Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text className="text-text-secondary text-sm">
            {dict.history.loading}
          </Text>
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center p-6 gap-3">
          <Ionicons
            name="cloud-offline-outline"
            size={36}
            color={Colors.danger}
          />
          <Text className="text-text-primary text-base font-semibold text-center">
            {error}
          </Text>
          <Pressable
            onPress={loadHistory}
            className="min-h-11 px-5 rounded-xl bg-primary items-center justify-center"
          >
            <Text className="text-black text-sm font-extrabold">
              {dict.common.retry}
            </Text>
          </Pressable>
        </View>
      ) : segment === "muscles" ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 36, gap: 14 }}
        >
          <MuscleBodyMap
            summaries={muscleSummaries}
            selectedMuscle={selectedMuscle}
            onSelectMuscle={setSelectedMuscle}
          />

          <Text className="text-text-secondary text-xs font-bold uppercase tracking-wider px-1">
            {dict.history.last30DaysHeading}
          </Text>

          {muscleList.map((item) => {
            const statusColor =
              item.statusLabel === "Fresh"
                ? Colors.primary
                : item.statusLabel === "Recovering"
                  ? Colors.warning
                  : Colors.danger;

            const statusText =
              item.statusLabel === "Fresh"
                ? dict.history.statusFresh
                : item.statusLabel === "Recovering"
                  ? dict.history.statusRecovering
                  : dict.history.statusFatigued;

            return (
              <View
                key={item.muscleGroup}
                style={Shadows.card}
                className="rounded-2xl bg-surface border border-border p-4 gap-2.5"
              >
                <View className="flex-row items-center justify-between gap-2">
                  <View className="flex-row items-center gap-2 flex-1">
                    <Text className="text-text-primary text-base font-extrabold">
                      {tMuscle(item.muscleGroup)}
                    </Text>
                    <View className="px-2 py-0.5 rounded-md bg-surface-elevated border border-border">
                      <Text
                        style={{ fontVariant: ["tabular-nums"] }}
                        className="text-text-secondary text-[11px] font-bold"
                      >
                        {item.setsCount} {dict.history.setsLabel} •{" "}
                        {item.volumeKg.toLocaleString()} kg
                      </Text>
                    </View>
                  </View>

                  <View
                    className="px-2.5 py-0.5 rounded-full border"
                    style={{
                      borderColor: statusColor,
                      backgroundColor: "rgba(255,255,255,0.03)",
                    }}
                  >
                    <Text
                      style={{
                        color: statusColor,
                        fontVariant: ["tabular-nums"],
                      }}
                      className="text-[11px] font-extrabold"
                    >
                      {statusText} {item.recoveryPercent}%
                    </Text>
                  </View>
                </View>

                <View className="h-2 w-full rounded-full bg-background overflow-hidden">
                  <View
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${Math.round(item.intensity * 100)}%`,
                    }}
                  />
                </View>

                <Text className="text-text-secondary text-xs leading-4">
                  {item.exercises.length > 0
                    ? item.exercises.join(", ")
                    : dict.history.noSets30Days}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            loadHistory();
          }}
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
          ListHeaderComponent={
            <View className="gap-3 mb-1">
              {/* Hero Card 1: Workouts + 14-Day Vertical Neon-Lime Bar Chart */}
              <View
                style={Shadows.card}
                className="rounded-2xl bg-surface border border-border p-4 gap-3"
              >
                <View className="flex-row items-start justify-between">
                  <View className="flex-1">
                    <Text className="text-text-primary text-sm font-bold">
                      {dict.history.workoutsThisMonth}
                    </Text>
                    <Text
                      style={{ fontVariant: ["tabular-nums"] }}
                      className="text-primary text-4xl font-extrabold mt-0.5"
                    >
                      {heroStats.monthWorkouts}
                    </Text>
                    <Text className="text-text-secondary text-xs mt-0.5">
                      {heroStats.monthWorkouts === 1
                        ? dict.history.workedOutOne
                        : formatTemplate(dict.history.workedOutMany, {
                            count: heroStats.monthWorkouts,
                          })}
                    </Text>
                  </View>
                  <Ionicons name="flame" size={22} color={Colors.primary} />
                </View>

                {/* 14-Day Vertical Bar Chart */}
                <View className="pt-2">
                  <View className="flex-row items-end justify-between h-20 gap-1">
                    {dailyBars.map((bar) => (
                      <View
                        key={bar.dateStr}
                        className="flex-1 items-center justify-end h-full"
                      >
                        <View
                          className={`w-2 rounded-full ${
                            bar.volume > 0
                              ? "bg-primary"
                              : "bg-surface-elevated"
                          }`}
                          style={{ height: `${bar.heightPct}%` }}
                        />
                      </View>
                    ))}
                  </View>
                  <View className="flex-row justify-between mt-1.5">
                    <Text className="text-text-muted text-[10px]">
                      {dailyBars[0]?.dayNum}
                    </Text>
                    <Text className="text-text-muted text-[10px]">
                      {dict.history.last14DaysVolume}
                    </Text>
                    <Text className="text-text-muted text-[10px]">
                      {dict.history.today}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Hero Card 2: Coral-Crimson Volume & Sets */}
              <View
                style={Shadows.card}
                className="rounded-2xl bg-surface border border-border p-4 flex-row items-center justify-between"
              >
                <View className="flex-1">
                  <Text className="text-text-primary text-sm font-bold">
                    {dict.history.weeklyVolume}
                  </Text>
                  <Text
                    style={{ fontVariant: ["tabular-nums"] }}
                    className="text-danger text-3xl font-extrabold mt-0.5"
                  >
                    {heroStats.weekVolumeKg.toLocaleString()} kg
                  </Text>
                  <Text className="text-text-secondary text-xs mt-0.5">
                    {formatTemplate(dict.history.setsThisWeek, {
                      sets: heroStats.weekSets,
                      monthVol: heroStats.monthVolumeKg.toLocaleString(),
                    })}
                  </Text>
                </View>
                <View className="w-11 h-11 rounded-2xl bg-danger/15 items-center justify-center">
                  <Ionicons name="barbell" size={22} color={Colors.danger} />
                </View>
              </View>

              {sessions.length > 0 && (
                <Text className="text-text-secondary text-xs font-bold uppercase tracking-wider pt-1">
                  {dict.history.completedSessions}
                </Text>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const expanded = expandedId === item.id;
            const grouped = groupLogsByExercise(item.set_logs ?? []);
            const sessionVolume = Math.round(
              (item.set_logs ?? []).reduce(
                (sum, log) =>
                  log.is_completed ? sum + log.weight_kg * log.reps : sum,
                0
              )
            );

            return (
              <Pressable
                onPress={() =>
                  setExpandedId((prev) => (prev === item.id ? null : item.id))
                }
                style={Shadows.card}
                className="rounded-2xl bg-surface border border-border p-4 gap-3"
              >
                <View className="flex-row items-start justify-between gap-2">
                  <View className="flex-1">
                    <Text className="text-text-secondary text-xs font-semibold">
                      {item.session_date} •{" "}
                      {formatDuration(item.started_at, item.completed_at)}
                    </Text>
                    <Text className="text-text-primary text-base font-extrabold mt-0.5">
                      {item.plan_name_snapshot}
                    </Text>
                  </View>

                  <Pressable
                    onPress={() => confirmDeleteSession(item)}
                    className="min-h-11 min-w-11 items-center justify-center rounded-xl bg-surface-elevated border border-border"
                  >
                    <Ionicons
                      name="trash-outline"
                      size={18}
                      color={Colors.danger}
                    />
                  </Pressable>
                </View>

                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2.5">
                    <View className="px-2.5 py-1 rounded-lg bg-surface-elevated border border-border">
                      <Text className="text-text-secondary text-xs font-medium">
                        {grouped.length}{" "}
                        {grouped.length === 1
                          ? dict.history.exerciseSingle
                          : dict.history.exercisePlural}
                      </Text>
                    </View>
                    <View className="px-2.5 py-1 rounded-lg bg-primary-subtle">
                      <Text
                        style={{ fontVariant: ["tabular-nums"] }}
                        className="text-primary text-xs font-extrabold"
                      >
                        {sessionVolume.toLocaleString()} kg
                      </Text>
                    </View>
                  </View>

                  <Ionicons
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={Colors.textSecondary}
                  />
                </View>

                {expanded && (
                  <View className="pt-2 border-t border-border gap-2.5">
                    {!!item.notes && (
                      <View className="p-2.5 rounded-xl bg-warning/10 border border-warning/30">
                        <Text className="text-warning text-xs font-bold mb-0.5">
                          {dict.history.sessionNotes}
                        </Text>
                        <Text className="text-text-primary text-xs">
                          {item.notes}
                        </Text>
                      </View>
                    )}

                    {grouped.map((group) => (
                      <View
                        key={group.exerciseId}
                        className="rounded-xl bg-surface-elevated border border-border p-3 gap-1.5"
                      >
                        <Text className="text-text-primary text-sm font-bold">
                          {group.name}
                        </Text>
                        <View className="flex-row flex-wrap gap-1.5">
                          {group.sets.map((s, idx) => (
                            <View
                              key={s.id ?? idx}
                              className="px-2.5 py-1 rounded-lg bg-background border border-border"
                            >
                              <Text
                                style={{ fontVariant: ["tabular-nums"] }}
                                className="text-text-secondary text-xs font-medium"
                              >
                                #{s.set_number}:{" "}
                                <Text className="text-text-primary font-bold">
                                  {s.weight_kg}kg × {s.reps}
                                </Text>
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View className="items-center justify-center py-14 px-6 gap-2">
              <Ionicons
                name="calendar-outline"
                size={36}
                color={Colors.textMuted}
              />
              <Text className="text-text-primary text-base font-bold">
                {dict.history.emptyTitle}
              </Text>
              <Text className="text-text-secondary text-sm text-center">
                {dict.history.emptyBody}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
