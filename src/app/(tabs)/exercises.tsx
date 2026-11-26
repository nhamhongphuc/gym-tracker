import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CustomExerciseModal } from "@/components/CustomExerciseModal";
import { Colors, Shadows } from "@/constants/theme";
import { fetchExercises } from "@/lib/api";
import type { Exercise } from "@/types/database";

const MUSCLE_FILTERS = [
  "All",
  "Chest",
  "Back",
  "Shoulders",
  "Legs",
  "Arms",
  "Core",
  "Cardio",
] as const;

const EQUIPMENT_FILTERS = [
  "All",
  "Barbell",
  "Dumbbell",
  "Cable",
  "Machine",
  "Body",
  "Kettlebell",
] as const;

export default function ExercisesScreen() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedMuscle, setSelectedMuscle] = useState<string>("All");
  const [selectedEquipment, setSelectedEquipment] = useState<string>("All");
  const [modalVisible, setModalVisible] = useState(false);

  const loadExercises = useCallback(async (forceRefresh = false) => {
    try {
      const data = await fetchExercises({ forceRefresh });
      setError(null);
      setExercises(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load exercises."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchExercises({ forceRefresh: false })
      .then((data) => {
        if (!active) return;
        setError(null);
        setExercises(data);
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "Failed to load exercises."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredExercises = useMemo(() => {
    const query = search.trim().toLowerCase();
    const eqFilter = selectedEquipment.toLowerCase();

    return exercises.filter((ex) => {
      if (selectedMuscle !== "All" && ex.muscle_group !== selectedMuscle) {
        return false;
      }
      if (
        selectedEquipment !== "All" &&
        !ex.equipment.toLowerCase().includes(eqFilter)
      ) {
        return false;
      }
      if (!query) return true;
      return (
        ex.name.toLowerCase().includes(query) ||
        ex.equipment.toLowerCase().includes(query) ||
        ex.muscle_group.toLowerCase().includes(query) ||
        ex.target_muscles.some((m) => m.toLowerCase().includes(query))
      );
    });
  }, [exercises, search, selectedMuscle, selectedEquipment]);

  function handleExerciseCreated(created: Exercise) {
    setExercises((prev) =>
      [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
    );
  }

  const renderItem = useCallback(({ item }: { item: Exercise }) => {
    const previewUri = item.gif_url ?? item.image_urls[0] ?? null;

    return (
      <Pressable
        onPress={() => router.push(`/exercise/${item.id}`)}
        style={Shadows.card}
        className="mx-4 mb-2.5 p-3 rounded-2xl bg-surface border border-border flex-row items-center gap-3 active:opacity-80"
      >
        <View className="w-[52px] h-[52px] rounded-xl bg-media-frame overflow-hidden items-center justify-center">
          {previewUri ? (
            <Image
              source={{ uri: previewUri }}
              style={{ width: 52, height: 52 }}
              contentFit="contain"
              cachePolicy="disk"
            />
          ) : (
            <Ionicons name="barbell-outline" size={24} color={Colors.textMuted} />
          )}
        </View>

        <View className="flex-1">
          <Text
            numberOfLines={1}
            className="text-text-primary text-base font-bold"
          >
            {item.name}
          </Text>
          <View className="flex-row items-center gap-2 mt-1">
            <View className="px-2 py-0.5 rounded-md bg-primary-subtle">
              <Text className="text-primary text-xs font-bold">
                {item.muscle_group}
              </Text>
            </View>
            <Text numberOfLines={1} className="text-text-secondary text-xs">
              {item.equipment}
            </Text>
          </View>
        </View>

        <Ionicons
          name="chevron-forward"
          size={18}
          color={Colors.textSecondary}
        />
      </Pressable>
    );
  }, []);

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: Colors.background }}
    >
      {/* Editorial SmartGym Header + Filters */}
      <View className="pt-2 pb-3 bg-surface border-b border-border gap-2.5">
        <View className="px-4 flex-row items-baseline justify-between">
          <Text className="text-text-primary text-2xl font-extrabold">
            Exercises
          </Text>
          <Text className="text-primary text-xs font-bold">
            {filteredExercises.length} of {exercises.length}
          </Text>
        </View>

        <View className="mx-4 px-3 min-h-11 rounded-xl bg-surface-elevated border border-border flex-row items-center gap-2">
          <Ionicons name="search" size={18} color={Colors.textSecondary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search exercises, muscles, equipment..."
            placeholderTextColor={Colors.textMuted}
            autoCorrect={false}
            className="flex-1 text-text-primary text-sm py-2"
          />
          {search.length > 0 && (
            <Pressable
              onPress={() => setSearch("")}
              className="min-h-11 min-w-11 items-center justify-center"
            >
              <Ionicons
                name="close-circle"
                size={18}
                color={Colors.textSecondary}
              />
            </Pressable>
          )}
        </View>

        {/* Muscle Filter Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        >
          {MUSCLE_FILTERS.map((muscle) => {
            const active = selectedMuscle === muscle;
            return (
              <Pressable
                key={muscle}
                onPress={() => setSelectedMuscle(muscle)}
                className={`min-h-9 px-3.5 rounded-full border items-center justify-center ${
                  active
                    ? "bg-primary border-primary"
                    : "bg-surface-elevated border-border"
                }`}
              >
                <Text
                  className={`text-xs font-bold ${
                    active ? "text-black" : "text-text-secondary"
                  }`}
                >
                  {muscle}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Equipment Filter Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        >
          {EQUIPMENT_FILTERS.map((eq) => {
            const active = selectedEquipment === eq;
            const label = eq === "Body" ? "Bodyweight" : eq;
            return (
              <Pressable
                key={eq}
                onPress={() => setSelectedEquipment(eq)}
                className={`min-h-8 px-3 rounded-lg border items-center justify-center ${
                  active
                    ? "bg-accent/20 border-accent"
                    : "bg-background border-border"
                }`}
              >
                <Text
                  className={`text-[11px] font-semibold ${
                    active ? "text-accent" : "text-text-secondary"
                  }`}
                >
                  {eq === "All" ? "All Equipment" : label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Main Content */}
      {loading ? (
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text className="text-text-secondary text-sm">
            Loading verified exercises...
          </Text>
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center p-6 gap-3">
          <Ionicons name="cloud-offline-outline" size={36} color={Colors.danger} />
          <Text className="text-text-primary text-base font-semibold text-center">
            {error}
          </Text>
          <Pressable
            onPress={() => loadExercises(true)}
            className="min-h-11 px-5 rounded-xl bg-primary items-center justify-center"
          >
            <Text className="text-black text-sm font-extrabold">Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filteredExercises}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          initialNumToRender={15}
          windowSize={7}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 96 }}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            loadExercises(true);
          }}
          ListEmptyComponent={
            <View className="items-center justify-center py-16 px-6">
              <Text className="text-text-secondary text-sm text-center">
                No exercises match &ldquo;
                {search || `${selectedMuscle} / ${selectedEquipment}`}&rdquo;.
              </Text>
            </View>
          }
          ListFooterComponent={
            <Text className="text-text-muted text-xs text-center py-4 px-6">
              Exercise data &amp; GIFs provided by AscendAPI (ExerciseDB)
            </Text>
          }
        />
      )}

      {/* Floating + Custom Button */}
      <Pressable
        onPress={() => setModalVisible(true)}
        style={Shadows.card}
        className="absolute right-4 bottom-4 min-h-12 px-4 rounded-full bg-primary flex-row items-center gap-1.5"
      >
        <Ionicons name="add" size={20} color="#000000" />
        <Text className="text-black text-sm font-extrabold">Custom</Text>
      </Pressable>

      <CustomExerciseModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onCreated={handleExerciseCreated}
      />
    </SafeAreaView>
  );
}
