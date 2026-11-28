import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Colors, Shadows } from "@/constants/theme";
import { useI18n } from "@/i18n/LanguageContext";
import {
  fetchExerciseById,
  fetchExercisePRStats,
  updateExerciseMediaAndTips,
} from "@/lib/api";
import { formatSetSummary, isCardioExercise } from "@/lib/exerciseUnits";
import type { Exercise, ExercisePRStats } from "@/types/database";

export default function ExerciseDetailModal() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { locale, dict, tMuscle, tEquipment } = useI18n();

  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [prStats, setPrStats] = useState<ExercisePRStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 2-frame image switcher for Free Exercise DB posture photos
  const [frameIndex, setFrameIndex] = useState(0);
  const [autoToggle, setAutoToggle] = useState(true);

  // Toggle between stored Vietnamese instructions and original English steps
  const [showOriginalSteps, setShowOriginalSteps] = useState(false);

  // Inline video_url editor
  const [editingVideo, setEditingVideo] = useState(false);
  const [videoDraft, setVideoDraft] = useState("");
  const [savingVideo, setSavingVideo] = useState(false);

  // Inline personal form cue (tips) editor
  const [editingTips, setEditingTips] = useState(false);
  const [tipsDraft, setTipsDraft] = useState("");
  const [savingTips, setSavingTips] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!id) return;
      try {
        const [ex, stats] = await Promise.all([
          fetchExerciseById(id),
          fetchExercisePRStats(id).catch(() => ({
            maxWeightKg: 0,
            maxReps: 0,
            bestEstimated1RM: 0,
            recentSessions: [],
          })),
        ]);
        if (!active) return;
        setError(null);
        setExercise(ex);
        setPrStats(stats);
        setVideoDraft(ex?.video_url ?? "");
        setTipsDraft(ex?.tips ?? "");
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : dict.exerciseDetail.notFound
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [id, dict.exerciseDetail.notFound]);

  // Auto-toggle start/finish posture frames every 1.2s when gif_url is absent
  const imageCount = exercise?.image_urls?.length ?? 0;
  useEffect(() => {
    if (!exercise || exercise.gif_url || imageCount < 2 || !autoToggle) return;
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev === 0 ? 1 : 0));
    }, 1200);
    return () => clearInterval(timer);
  }, [exercise, imageCount, autoToggle]);

  async function openExternalUrl(url: string) {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert(
          dict.exerciseDetail.invalidUrlTitle,
          dict.exerciseDetail.invalidUrlBody
        );
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        dict.exerciseDetail.openFailedTitle,
        dict.exerciseDetail.openFailedBody
      );
    }
  }

  async function handleSaveVideo() {
    if (!exercise) return;
    const trimmed = videoDraft.trim();
    setSavingVideo(true);
    try {
      const updated = await updateExerciseMediaAndTips(exercise.id, {
        video_url: trimmed || null,
      });
      setExercise(updated);
      setEditingVideo(false);
    } catch (err) {
      Alert.alert(
        dict.exerciseDetail.saveFailedTitle,
        err instanceof Error ? err.message : dict.exerciseDetail.saveFailedTitle
      );
    } finally {
      setSavingVideo(false);
    }
  }

  async function handleSaveTips() {
    if (!exercise) return;
    const trimmed = tipsDraft.trim();
    setSavingTips(true);
    try {
      const updated = await updateExerciseMediaAndTips(exercise.id, {
        tips: trimmed || null,
      });
      setExercise(updated);
      setEditingTips(false);
    } catch (err) {
      Alert.alert(
        dict.exerciseDetail.saveFailedTitle,
        err instanceof Error ? err.message : dict.exerciseDetail.saveFailedTitle
      );
    } finally {
      setSavingTips(false);
    }
  }

  const searchQuery = exercise
    ? locale === "vi"
      ? `hướng dẫn tập ${exercise.name} đúng kỹ thuật`
      : `${exercise.name} proper form tutorial`
    : "";
  const youtubeSearchUrl = searchQuery
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(
        searchQuery
      )}`
    : "";
  const tiktokSearchUrl = searchQuery
    ? `https://www.tiktok.com/search?q=${encodeURIComponent(searchQuery)}`
    : "";
  const isCardio = isCardioExercise(exercise);

  const viInstructions = exercise?.instructions_vi ?? [];
  const hasViInstructions = viInstructions.length > 0;
  const displayedInstructions =
    locale === "vi" && !showOriginalSteps && hasViInstructions
      ? viInstructions
      : exercise?.instructions ?? [];

  const sourceAttribution = exercise
    ? exercise.source_name === "ExerciseDB"
      ? dict.exerciseDetail.sourceExerciseDB
      : exercise.source_name === "FreeExerciseDB"
        ? dict.exerciseDetail.sourceFreeExerciseDB
        : dict.exerciseDetail.sourceCustom
    : "";

  return (
    <View className="flex-1 bg-background">
      {/* Keep exercise name in English per standard Vietnamese gym usage */}
      <Stack.Screen
        options={{
          title: exercise?.name ?? dict.exerciseDetail.defaultTitle,
        }}
      />

      {loading ? (
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text className="text-text-secondary text-sm">
            {dict.exerciseDetail.loading}
          </Text>
        </View>
      ) : error || !exercise ? (
        <View className="flex-1 items-center justify-center p-6 gap-2">
          <Ionicons
            name="alert-circle-outline"
            size={36}
            color={Colors.danger}
          />
          <Text className="text-text-primary text-base font-semibold text-center">
            {error ?? dict.exerciseDetail.notFound}
          </Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* 1. Verified Visual Demo Container */}
            <View
              style={Shadows.card}
              className="rounded-2xl bg-media-frame overflow-hidden border border-border"
            >
              {exercise.gif_url ? (
                <Image
                  source={{ uri: exercise.gif_url }}
                  style={{ width: "100%", height: 240 }}
                  contentFit="contain"
                  cachePolicy="disk"
                />
              ) : exercise.image_urls.length > 0 ? (
                <View>
                  <Image
                    source={{
                      uri:
                        exercise.image_urls[frameIndex] ??
                        exercise.image_urls[0],
                    }}
                    style={{ width: "100%", height: 240 }}
                    contentFit="contain"
                    cachePolicy="disk"
                  />
                  {exercise.image_urls.length > 1 && (
                    <View className="flex-row items-center justify-between px-3 py-2 bg-surface/90 border-t border-border">
                      <Text className="text-text-secondary text-xs font-medium">
                        {frameIndex === 0
                          ? dict.exerciseDetail.startPos
                          : dict.exerciseDetail.finishPos}
                      </Text>
                      <Pressable
                        onPress={() => {
                          setAutoToggle(false);
                          setFrameIndex((prev) => (prev === 0 ? 1 : 0));
                        }}
                        accessibilityRole="button"
                        className="min-h-11 px-3.5 rounded-lg bg-surface-elevated border border-border items-center justify-center active:opacity-75"
                      >
                        <Text className="text-text-primary text-xs font-semibold">
                          {dict.exerciseDetail.switchFrame}
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ) : (
                <View className="h-44 items-center justify-center gap-2">
                  <Ionicons
                    name="barbell-outline"
                    size={44}
                    color={Colors.textMuted}
                  />
                  <Text className="text-text-muted text-xs">
                    {dict.exerciseDetail.noVisual}
                  </Text>
                </View>
              )}
            </View>

            {/* 2. HD Form Video Bar */}
            <View className="rounded-2xl bg-surface border border-border p-4 gap-3">
              {exercise.video_url && !editingVideo ? (
                <View className="flex-row items-center gap-2">
                  <Pressable
                    onPress={() => openExternalUrl(exercise.video_url!)}
                    accessibilityRole="button"
                    className="flex-1 min-h-11 px-4 rounded-xl bg-accent flex-row items-center justify-center gap-2 active:opacity-75"
                  >
                    <Ionicons name="play-circle" size={20} color="#FFFFFF" />
                    <Text className="text-text-primary text-sm font-bold">
                      {dict.exerciseDetail.watchVideo}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setVideoDraft(exercise.video_url ?? "");
                      setEditingVideo(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Edit video link"
                    className="min-h-11 min-w-11 rounded-xl bg-surface-elevated border border-border items-center justify-center active:opacity-75"
                  >
                    <Ionicons
                      name="create-outline"
                      size={18}
                      color={Colors.textSecondary}
                    />
                  </Pressable>
                </View>
              ) : editingVideo ? (
                <View className="gap-2">
                  <TextInput
                    value={videoDraft}
                    onChangeText={setVideoDraft}
                    placeholder={dict.exerciseDetail.videoPlaceholder}
                    placeholderTextColor={Colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    className="bg-surface-elevated border border-border rounded-xl px-3 py-2.5 text-text-primary text-sm"
                  />
                  <View className="flex-row justify-end gap-2">
                    <Pressable
                      onPress={() => setEditingVideo(false)}
                      accessibilityRole="button"
                      className="min-h-11 px-4 rounded-xl bg-surface-elevated items-center justify-center active:opacity-75"
                    >
                      <Text className="text-text-secondary text-xs font-semibold">
                        {dict.common.cancel}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={handleSaveVideo}
                      disabled={savingVideo}
                      accessibilityRole="button"
                      className="min-h-11 px-4 rounded-xl bg-primary items-center justify-center active:opacity-75"
                    >
                      <Text className="text-black text-xs font-extrabold">
                        {savingVideo
                          ? dict.common.saving
                          : dict.exerciseDetail.saveLink}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  onPress={() => setEditingVideo(true)}
                  accessibilityRole="button"
                  className="min-h-11 px-4 rounded-xl bg-surface-elevated border border-border flex-row items-center justify-center gap-2 active:opacity-75"
                >
                  <Ionicons
                    name="add-circle-outline"
                    size={18}
                    color={Colors.accent}
                  />
                  <Text className="text-accent text-sm font-semibold">
                    {dict.exerciseDetail.attachVideo}
                  </Text>
                </Pressable>
              )}

              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => openExternalUrl(youtubeSearchUrl)}
                  accessibilityRole="button"
                  className="flex-1 min-h-11 px-3 rounded-xl bg-surface-elevated border border-border flex-row items-center justify-center gap-2 active:opacity-75"
                >
                  <Ionicons
                    name="logo-youtube"
                    size={18}
                    color={Colors.danger}
                  />
                  <Text
                    numberOfLines={1}
                    className="text-text-primary text-xs font-bold"
                  >
                    {dict.exerciseDetail.searchYoutube}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => openExternalUrl(tiktokSearchUrl)}
                  accessibilityRole="button"
                  className="flex-1 min-h-11 px-3 rounded-xl bg-surface-elevated border border-border flex-row items-center justify-center gap-2 active:opacity-75"
                >
                  <Ionicons
                    name="logo-tiktok"
                    size={17}
                    color={Colors.textPrimary}
                  />
                  <Text
                    numberOfLines={1}
                    className="text-text-primary text-xs font-bold"
                  >
                    {dict.exerciseDetail.searchTiktok}
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* 3. Muscle Breakdown */}
            <View className="rounded-2xl bg-surface border border-border p-4 gap-3">
              <Text className="text-text-primary text-base font-bold">
                {dict.exerciseDetail.breakdownTitle}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                <View className="px-3 py-1 rounded-full bg-primary-subtle border border-primary">
                  <Text className="text-primary text-xs font-bold">
                    {tMuscle(exercise.muscle_group)}
                  </Text>
                </View>
                <View className="px-3 py-1 rounded-full bg-surface-elevated border border-border">
                  <Text className="text-text-primary text-xs font-semibold">
                    {tEquipment(exercise.equipment)}
                  </Text>
                </View>
                {exercise.target_muscles.map((muscle) => (
                  <View
                    key={`t-${muscle}`}
                    className="px-3 py-1 rounded-full bg-accent/15 border border-accent/40"
                  >
                    <Text className="text-accent text-xs font-medium">
                      {dict.exerciseDetail.targetPrefix}: {muscle}
                    </Text>
                  </View>
                ))}
                {exercise.secondary_muscles.map((muscle) => (
                  <View
                    key={`s-${muscle}`}
                    className="px-3 py-1 rounded-full bg-surface-elevated border border-border"
                  >
                    <Text className="text-text-secondary text-xs">
                      {dict.exerciseDetail.secondaryPrefix}: {muscle}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {/* 4. Personal Form Cue (Editable Amber Callout) */}
            <View className="rounded-2xl bg-warning/10 border border-warning/40 p-4 gap-2">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  <Ionicons
                    name="bulb-outline"
                    size={18}
                    color={Colors.warning}
                  />
                  <Text className="text-warning text-sm font-bold">
                    {dict.exerciseDetail.cueTitle}
                  </Text>
                </View>
                {!editingTips && (
                  <Pressable
                    onPress={() => {
                      setTipsDraft(exercise.tips ?? "");
                      setEditingTips(true);
                    }}
                    accessibilityRole="button"
                    className="min-h-11 px-3.5 rounded-lg bg-warning/15 items-center justify-center active:opacity-75"
                  >
                    <Text className="text-warning text-xs font-semibold">
                      {exercise.tips
                        ? dict.common.edit
                        : dict.exerciseDetail.addCue}
                    </Text>
                  </Pressable>
                )}
              </View>

              {editingTips ? (
                <View className="gap-2 mt-1">
                  <TextInput
                    value={tipsDraft}
                    onChangeText={setTipsDraft}
                    placeholder={dict.exerciseDetail.cuePlaceholder}
                    placeholderTextColor={Colors.textMuted}
                    multiline
                    className="bg-surface border border-border rounded-xl px-3 py-2.5 text-text-primary text-sm min-h-20"
                  />
                  <View className="flex-row justify-end gap-2">
                    <Pressable
                      onPress={() => setEditingTips(false)}
                      accessibilityRole="button"
                      className="min-h-11 px-4 rounded-xl bg-surface items-center justify-center active:opacity-75"
                    >
                      <Text className="text-text-secondary text-xs font-semibold">
                        {dict.common.cancel}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={handleSaveTips}
                      disabled={savingTips}
                      accessibilityRole="button"
                      className="min-h-11 px-4 rounded-xl bg-warning items-center justify-center active:opacity-75"
                    >
                      <Text className="text-black text-xs font-extrabold">
                        {savingTips
                          ? dict.common.saving
                          : dict.exerciseDetail.saveCue}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Text className="text-text-primary text-sm leading-5">
                  {exercise.tips || dict.exerciseDetail.noCue}
                </Text>
              )}
            </View>

            {/* 5. Verified Step-by-Step Instructions (Stored in Supabase instructions_vi) */}
            <View className="rounded-2xl bg-surface border border-border p-4 gap-3">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="text-text-primary text-base font-bold flex-1">
                  {dict.exerciseDetail.instructionsTitle}
                </Text>

                {locale === "vi" &&
                  hasViInstructions &&
                  exercise.instructions.length > 0 && (
                    <Pressable
                      onPress={() => setShowOriginalSteps((prev) => !prev)}
                      hitSlop={4}
                      accessibilityRole="button"
                      className="min-h-10 px-3 rounded-lg bg-surface-elevated border border-border items-center justify-center active:opacity-75"
                    >
                      <Text className="text-text-secondary text-[11px] font-bold">
                        {showOriginalSteps
                          ? dict.exerciseDetail.showTranslated
                          : dict.exerciseDetail.showOriginal}
                      </Text>
                    </Pressable>
                  )}
              </View>

              {exercise.instructions.length === 0 ? (
                <Text className="text-text-secondary text-sm">
                  {dict.exerciseDetail.noInstructions}
                </Text>
              ) : (
                displayedInstructions.map((step, idx) => (
                  <View
                    key={idx}
                    className="flex-row gap-3 p-3 rounded-xl bg-surface-elevated border border-border"
                  >
                    <View className="w-6 h-6 rounded-full bg-primary-subtle items-center justify-center mt-0.5">
                      <Text
                        style={{ fontVariant: ["tabular-nums"] }}
                        className="text-primary text-xs font-bold"
                      >
                        {idx + 1}
                      </Text>
                    </View>
                    <Text className="flex-1 text-text-primary text-sm leading-5">
                      {step}
                    </Text>
                  </View>
                ))
              )}
            </View>

            {/* 6. Personal Records & Recent Sets */}
            <View className="rounded-2xl bg-surface border border-border p-4 gap-3">
              <Text className="text-text-primary text-base font-bold">
                {dict.exerciseDetail.prTitle}
              </Text>
              <View className="flex-row gap-3">
                <View className="flex-1 rounded-xl bg-surface-elevated border border-border p-3 items-center">
                  <Text className="text-text-secondary text-xs">
                    {isCardio
                      ? dict.exerciseDetail.longestDistance
                      : dict.exerciseDetail.heaviestWeight}
                  </Text>
                  <Text
                    style={{ fontVariant: ["tabular-nums"] }}
                    className="text-primary text-xl font-bold mt-1"
                  >
                    {prStats?.maxWeightKg
                      ? `${prStats.maxWeightKg} ${isCardio ? "km" : "kg"}`
                      : "—"}
                  </Text>
                </View>
                <View className="flex-1 rounded-xl bg-surface-elevated border border-border p-3 items-center">
                  <Text className="text-text-secondary text-xs">
                    {isCardio
                      ? dict.exerciseDetail.longestDuration
                      : dict.exerciseDetail.est1RM}
                  </Text>
                  <Text
                    style={{ fontVariant: ["tabular-nums"] }}
                    className="text-accent text-xl font-bold mt-1"
                  >
                    {isCardio
                      ? prStats?.maxReps
                        ? `${prStats.maxReps} min`
                        : "—"
                      : prStats?.bestEstimated1RM
                        ? `${prStats.bestEstimated1RM} kg`
                        : "—"}
                  </Text>
                </View>
              </View>

              {prStats && prStats.recentSessions.length > 0 ? (
                <View className="gap-2 mt-1">
                  {prStats.recentSessions.map((session, sIdx) => (
                    <View
                      key={`${session.sessionDate}-${sIdx}`}
                      className="rounded-xl bg-surface-elevated border border-border p-3 gap-1.5"
                    >
                      <Text className="text-text-secondary text-xs font-semibold">
                        {session.sessionDate ||
                          dict.exerciseDetail.recentSessionFallback}
                      </Text>
                      <View className="flex-row flex-wrap gap-2">
                        {session.sets.map((s) => (
                          <View
                            key={s.set_number}
                            className="px-2.5 py-1 rounded-lg bg-surface border border-border"
                          >
                            <Text
                              style={{ fontVariant: ["tabular-nums"] }}
                              className="text-text-primary text-xs font-medium"
                            >
                              #{s.set_number}:{" "}
                              {formatSetSummary(
                                s.weight_kg,
                                s.reps,
                                isCardio,
                                s.speed_kmh,
                                s.incline_pct
                              )}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <Text className="text-text-secondary text-sm">
                  {dict.exerciseDetail.noSetsLogged}
                </Text>
              )}
            </View>

            {/* 7. Source Attribution */}
            <Text className="text-text-muted text-xs text-center pt-1">
              {sourceAttribution}
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}
