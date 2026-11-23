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
import {
  fetchExerciseById,
  fetchExercisePRStats,
  updateExerciseMediaAndTips,
} from "@/lib/api";
import type { Exercise, ExercisePRStats } from "@/types/database";

const SOURCE_LABELS: Record<Exercise["source_name"], string> = {
  ExerciseDB: "Source: ExerciseDB (AscendAPI)",
  FreeExerciseDB: "Source: Free Exercise DB",
  Custom: "Custom Exercise",
};

export default function ExerciseDetailModal() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [prStats, setPrStats] = useState<ExercisePRStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 2-frame image switcher for Free Exercise DB posture photos
  const [frameIndex, setFrameIndex] = useState(0);
  const [autoToggle, setAutoToggle] = useState(true);

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
        setError(null);
        const [ex, stats] = await Promise.all([
          fetchExerciseById(id),
          fetchExercisePRStats(id).catch(() => ({
            maxWeightKg: 0,
            bestEstimated1RM: 0,
            recentSessions: [],
          })),
        ]);
        if (!active) return;
        setExercise(ex);
        setPrStats(stats);
        setVideoDraft(ex?.video_url ?? "");
        setTipsDraft(ex?.tips ?? "");
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "Failed to load exercise."
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [id]);

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
        Alert.alert("Invalid URL", "Cannot open this link on your device.");
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert("Open Failed", "Could not open the video link.");
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
        "Save Failed",
        err instanceof Error ? err.message : "Could not save video URL."
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
        "Save Failed",
        err instanceof Error ? err.message : "Could not save form cue."
      );
    } finally {
      setSavingTips(false);
    }
  }

  const youtubeSearchUrl = exercise
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(
        `${exercise.name} proper form tutorial`
      )}`
    : "";

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: exercise?.name ?? "Exercise Details",
        }}
      />

      {loading ? (
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text className="text-text-secondary text-sm">
            Loading exercise details...
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
            {error ?? "Exercise not found."}
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
                          ? "Start Position (1/2)"
                          : "Finish Position (2/2)"}
                      </Text>
                      <Pressable
                        onPress={() => {
                          setAutoToggle(false);
                          setFrameIndex((prev) => (prev === 0 ? 1 : 0));
                        }}
                        className="min-h-9 px-3 rounded-lg bg-surface-elevated border border-border items-center justify-center"
                      >
                        <Text className="text-text-primary text-xs font-semibold">
                          Switch Frame
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
                    No visual demo attached
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
                    className="flex-1 min-h-11 px-4 rounded-xl bg-accent flex-row items-center justify-center gap-2"
                  >
                    <Ionicons name="play-circle" size={20} color="#F9FAFB" />
                    <Text className="text-text-primary text-sm font-bold">
                      Watch Verified Form Video
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setVideoDraft(exercise.video_url ?? "");
                      setEditingVideo(true);
                    }}
                    className="min-h-11 min-w-11 rounded-xl bg-surface-elevated border border-border items-center justify-center"
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
                    placeholder="Paste YouTube or verified video URL..."
                    placeholderTextColor={Colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    className="bg-surface-elevated border border-border rounded-xl px-3 py-2.5 text-text-primary text-sm"
                  />
                  <View className="flex-row justify-end gap-2">
                    <Pressable
                      onPress={() => setEditingVideo(false)}
                      className="min-h-10 px-4 rounded-xl bg-surface-elevated items-center justify-center"
                    >
                      <Text className="text-text-secondary text-xs font-semibold">
                        Cancel
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={handleSaveVideo}
                      disabled={savingVideo}
                      className="min-h-10 px-4 rounded-xl bg-primary items-center justify-center"
                    >
                      <Text className="text-background text-xs font-bold">
                        {savingVideo ? "Saving..." : "Save Link"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  onPress={() => setEditingVideo(true)}
                  className="min-h-11 px-4 rounded-xl bg-surface-elevated border border-border flex-row items-center justify-center gap-2"
                >
                  <Ionicons name="add-circle-outline" size={18} color={Colors.accent} />
                  <Text className="text-accent text-sm font-semibold">
                    + Attach Form Video URL
                  </Text>
                </Pressable>
              )}

              <Pressable
                onPress={() => openExternalUrl(youtubeSearchUrl)}
                className="min-h-11 px-4 rounded-xl bg-surface-elevated border border-border flex-row items-center justify-center gap-2"
              >
                <Ionicons name="logo-youtube" size={18} color={Colors.danger} />
                <Text className="text-text-primary text-sm font-medium">
                  Search Form Tutorial on YouTube
                </Text>
              </Pressable>
            </View>

            {/* 3. Muscle Breakdown */}
            <View className="rounded-2xl bg-surface border border-border p-4 gap-3">
              <Text className="text-text-primary text-base font-bold">
                Muscle &amp; Equipment Breakdown
              </Text>
              <View className="flex-row flex-wrap gap-2">
                <View className="px-3 py-1 rounded-full bg-primary-subtle border border-primary">
                  <Text className="text-primary text-xs font-bold">
                    {exercise.muscle_group}
                  </Text>
                </View>
                <View className="px-3 py-1 rounded-full bg-surface-elevated border border-border">
                  <Text className="text-text-primary text-xs font-semibold">
                    {exercise.equipment}
                  </Text>
                </View>
                {exercise.target_muscles.map((muscle) => (
                  <View
                    key={`t-${muscle}`}
                    className="px-3 py-1 rounded-full bg-accent/15 border border-accent/40"
                  >
                    <Text className="text-accent text-xs font-medium">
                      Target: {muscle}
                    </Text>
                  </View>
                ))}
                {exercise.secondary_muscles.map((muscle) => (
                  <View
                    key={`s-${muscle}`}
                    className="px-3 py-1 rounded-full bg-surface-elevated border border-border"
                  >
                    <Text className="text-text-secondary text-xs">
                      Secondary: {muscle}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {/* 4. Personal Form Cue (Editable Amber Callout) */}
            <View className="rounded-2xl bg-warning/10 border border-warning/40 p-4 gap-2">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2">
                  <Ionicons name="bulb-outline" size={18} color={Colors.warning} />
                  <Text className="text-warning text-sm font-bold">
                    Personal Form Cue
                  </Text>
                </View>
                {!editingTips && (
                  <Pressable
                    onPress={() => {
                      setTipsDraft(exercise.tips ?? "");
                      setEditingTips(true);
                    }}
                    className="min-h-9 px-3 rounded-lg bg-warning/15 items-center justify-center"
                  >
                    <Text className="text-warning text-xs font-semibold">
                      {exercise.tips ? "Edit" : "+ Add Cue"}
                    </Text>
                  </Pressable>
                )}
              </View>

              {editingTips ? (
                <View className="gap-2 mt-1">
                  <TextInput
                    value={tipsDraft}
                    onChangeText={setTipsDraft}
                    placeholder="e.g., Bench notch 3, tuck elbows 45°..."
                    placeholderTextColor={Colors.textMuted}
                    multiline
                    className="bg-surface border border-border rounded-xl px-3 py-2.5 text-text-primary text-sm min-h-20"
                  />
                  <View className="flex-row justify-end gap-2">
                    <Pressable
                      onPress={() => setEditingTips(false)}
                      className="min-h-10 px-4 rounded-xl bg-surface items-center justify-center"
                    >
                      <Text className="text-text-secondary text-xs font-semibold">
                        Cancel
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={handleSaveTips}
                      disabled={savingTips}
                      className="min-h-10 px-4 rounded-xl bg-warning items-center justify-center"
                    >
                      <Text className="text-background text-xs font-bold">
                        {savingTips ? "Saving..." : "Save Cue"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Text className="text-text-primary text-sm leading-5">
                  {exercise.tips ||
                    "No personal cue saved yet. Tap + Add Cue to save bench notch or grip reminders."}
                </Text>
              )}
            </View>

            {/* 5. Verified Step-by-Step Instructions */}
            <View className="rounded-2xl bg-surface border border-border p-4 gap-3">
              <Text className="text-text-primary text-base font-bold">
                Step-by-Step Instructions
              </Text>
              {exercise.instructions.length === 0 ? (
                <Text className="text-text-secondary text-sm">
                  No instructions provided for this exercise.
                </Text>
              ) : (
                exercise.instructions.map((step, idx) => (
                  <View
                    key={idx}
                    className="flex-row gap-3 p-3 rounded-xl bg-surface-elevated border border-border"
                  >
                    <View className="w-6 h-6 rounded-full bg-primary-subtle items-center justify-center mt-0.5">
                      <Text className="text-primary text-xs font-bold">
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
                Personal Records &amp; Recent Sets
              </Text>
              <View className="flex-row gap-3">
                <View className="flex-1 rounded-xl bg-surface-elevated border border-border p-3 items-center">
                  <Text className="text-text-secondary text-xs">
                    Heaviest Weight
                  </Text>
                  <Text className="text-primary text-xl font-bold mt-1">
                    {prStats?.maxWeightKg ? `${prStats.maxWeightKg} kg` : "—"}
                  </Text>
                </View>
                <View className="flex-1 rounded-xl bg-surface-elevated border border-border p-3 items-center">
                  <Text className="text-text-secondary text-xs">Est. 1RM</Text>
                  <Text className="text-accent text-xl font-bold mt-1">
                    {prStats?.bestEstimated1RM
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
                        {session.sessionDate || "Recent Session"}
                      </Text>
                      <View className="flex-row flex-wrap gap-2">
                        {session.sets.map((s) => (
                          <View
                            key={s.set_number}
                            className="px-2.5 py-1 rounded-lg bg-surface border border-border"
                          >
                            <Text className="text-text-primary text-xs font-medium">
                              #{s.set_number}: {s.weight_kg}kg × {s.reps}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <Text className="text-text-secondary text-sm">
                  No sets logged yet for this exercise.
                </Text>
              )}
            </View>

            {/* 7. Source Attribution */}
            <Text className="text-text-muted text-xs text-center pt-1">
              {SOURCE_LABELS[exercise.source_name]}
              {exercise.source_name === "ExerciseDB"
                ? " • Exercise data & GIFs provided by AscendAPI (ExerciseDB)"
                : ""}
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}
