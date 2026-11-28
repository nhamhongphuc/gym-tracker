import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Colors, Shadows } from "@/constants/theme";
import { formatTemplate, useI18n } from "@/i18n/LanguageContext";
import { fetchExercises } from "@/lib/api";
import {
  EQUIPMENT_FILTERS,
  filterExerciseList,
  MUSCLE_FILTERS,
} from "@/lib/exerciseUnits";
import type { Exercise } from "@/types/database";

interface ExercisePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (exercise: Exercise) => Promise<void> | void;
  existingExerciseIds?: Set<string>;
  title?: string;
}

export function ExercisePickerModal({
  visible,
  onClose,
  onSelect,
  existingExerciseIds,
  title,
}: ExercisePickerModalProps) {
  const { dict, tMuscle, tEquipment } = useI18n();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedMuscle, setSelectedMuscle] = useState<string>("All");
  const [selectedEquipment, setSelectedEquipment] = useState<string>("All");
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || exercises.length > 0) return;

    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const list = await fetchExercises();
        if (active) setExercises(list);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : dict.exercises.loadError
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [visible, exercises.length, dict.exercises.loadError]);

  const filteredExercises = useMemo(
    () =>
      filterExerciseList(
        exercises,
        search,
        selectedMuscle,
        selectedEquipment
      ),
    [exercises, search, selectedMuscle, selectedEquipment]
  );

  async function handleSelect(item: Exercise) {
    if (addingId) return;
    setAddingId(item.id);
    try {
      await onSelect(item);
    } finally {
      setAddingId(null);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView
        edges={["top", "bottom"]}
        style={{ flex: 1, backgroundColor: Colors.background }}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3 bg-surface border-b border-border">
          <Text className="text-text-primary text-base font-extrabold">
            {title ?? dict.pickerModal.title}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            className="min-h-11 min-w-11 items-center justify-center px-2 active:opacity-75"
          >
            <Text className="text-primary text-base font-bold">
              {dict.common.done}
            </Text>
          </Pressable>
        </View>

        {/* Search + Filter Chips */}
        <View className="pt-3 pb-2.5 bg-surface border-b border-border gap-2">
          <View className="mx-4 px-3 min-h-11 rounded-xl bg-surface-elevated border border-border flex-row items-center gap-2">
            <Ionicons name="search" size={18} color={Colors.textSecondary} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={dict.pickerModal.searchPlaceholder}
              placeholderTextColor={Colors.textMuted}
              autoCorrect={false}
              className="flex-1 text-text-primary text-sm py-2"
            />
            {search.length > 0 && (
              <Pressable
                onPress={() => setSearch("")}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                className="min-h-11 min-w-11 items-center justify-center active:opacity-75"
              >
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={Colors.textSecondary}
                />
              </Pressable>
            )}
          </View>

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
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className={`min-h-11 px-3.5 rounded-full border items-center justify-center active:opacity-75 ${
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
                    {tMuscle(muscle)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          >
            {EQUIPMENT_FILTERS.map((eq) => {
              const active = selectedEquipment === eq;
              return (
                <Pressable
                  key={eq}
                  onPress={() => setSelectedEquipment(eq)}
                  hitSlop={{ top: 4, bottom: 4 }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className={`min-h-10 px-3 rounded-lg border items-center justify-center active:opacity-75 ${
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
                    {tEquipment(eq)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Exercise List */}
        {loading ? (
          <View className="flex-1 items-center justify-center gap-3">
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text className="text-text-secondary text-sm">
              {dict.pickerModal.loading}
            </Text>
          </View>
        ) : error ? (
          <View className="flex-1 items-center justify-center p-6 gap-2">
            <Ionicons
              name="cloud-offline-outline"
              size={34}
              color={Colors.danger}
            />
            <Text className="text-text-primary text-sm font-semibold text-center">
              {error}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredExercises}
            keyExtractor={(item) => item.id}
            initialNumToRender={15}
            windowSize={7}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}
            renderItem={({ item }) => {
              const previewUri = item.gif_url ?? item.image_urls[0] ?? null;
              const isAdded = existingExerciseIds?.has(item.id) ?? false;
              const isBusy = addingId === item.id;

              return (
                <View
                  style={Shadows.card}
                  className="mx-4 mb-2.5 p-3 rounded-2xl bg-surface border border-border flex-row items-center gap-3"
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
                      <Ionicons
                        name="barbell-outline"
                        size={24}
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
                    <View className="flex-row items-center gap-2 mt-1">
                      <View className="px-2 py-0.5 rounded-md bg-primary-subtle">
                        <Text className="text-primary text-xs font-bold">
                          {tMuscle(item.muscle_group)}
                        </Text>
                      </View>
                      <Text
                        numberOfLines={1}
                        className="text-text-secondary text-xs flex-1"
                      >
                        {tEquipment(item.equipment)}
                      </Text>
                    </View>
                  </View>

                  <Pressable
                    onPress={() => handleSelect(item)}
                    disabled={isAdded || isBusy}
                    accessibilityRole="button"
                    className={`min-h-11 px-3.5 rounded-xl flex-row items-center justify-center gap-1 active:opacity-75 ${
                      isAdded
                        ? "bg-primary-subtle border border-primary/40"
                        : "bg-primary"
                    }`}
                  >
                    {isBusy ? (
                      <ActivityIndicator size="small" color="#000000" />
                    ) : isAdded ? (
                      <>
                        <Ionicons
                          name="checkmark"
                          size={16}
                          color={Colors.primary}
                        />
                        <Text className="text-primary text-xs font-bold">
                          {dict.pickerModal.added}
                        </Text>
                      </>
                    ) : (
                      <>
                        <Ionicons name="add" size={16} color="#000000" />
                        <Text className="text-black text-xs font-extrabold">
                          {dict.pickerModal.add}
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
              );
            }}
            ListEmptyComponent={
              <View className="items-center justify-center py-14 px-6">
                <Text className="text-text-secondary text-sm text-center">
                  {formatTemplate(dict.pickerModal.emptyMatch, {
                    query:
                      search ||
                      `${tMuscle(selectedMuscle)} / ${tEquipment(
                        selectedEquipment
                      )}`,
                  })}
                </Text>
              </View>
            }
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}
