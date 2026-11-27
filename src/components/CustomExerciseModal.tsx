import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Colors, Shadows } from "@/constants/theme";
import { useI18n } from "@/i18n/LanguageContext";
import { createCustomExercise } from "@/lib/api";
import type { Exercise, MuscleGroup } from "@/types/database";

const MUSCLE_GROUPS: MuscleGroup[] = [
  "Chest",
  "Back",
  "Shoulders",
  "Legs",
  "Arms",
  "Core",
  "Cardio",
  "Other",
];

interface CustomExerciseModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated: (exercise: Exercise) => void;
}

export function CustomExerciseModal({
  visible,
  onClose,
  onCreated,
}: CustomExerciseModalProps) {
  const { locale, dict, tMuscle } = useI18n();
  const [name, setName] = useState("");
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup>("Chest");
  const [equipment, setEquipment] = useState("Dumbbell");
  const [instructionsText, setInstructionsText] = useState("");
  const [tips, setTips] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [saving, setSaving] = useState(false);

  function resetForm() {
    setName("");
    setMuscleGroup("Chest");
    setEquipment("Dumbbell");
    setInstructionsText("");
    setTips("");
    setVideoUrl("");
  }

  function handleClose() {
    if (saving) return;
    onClose();
  }

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert(
        dict.customModal.missingNameTitle,
        dict.customModal.missingNameBody
      );
      return;
    }

    const instructions = instructionsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    setSaving(true);
    try {
      const created = await createCustomExercise({
        name: trimmedName,
        muscle_group: muscleGroup,
        target_muscles: [muscleGroup],
        secondary_muscles: [],
        equipment: equipment.trim() || "Bodyweight",
        instructions,
        instructions_vi: locale === "vi" ? instructions : [],
        tips: tips.trim() || null,
        gif_url: null,
        image_urls: [],
        video_url: videoUrl.trim() || null,
      });
      resetForm();
      onCreated(created);
      onClose();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : dict.customModal.saveFailedBody;
      Alert.alert(dict.customModal.saveFailedTitle, message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView
        edges={["top", "bottom"]}
        style={{ flex: 1, backgroundColor: Colors.background }}
      >
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {/* Modal Header */}
          <View className="flex-row items-center justify-between px-4 py-3 bg-surface border-b border-border">
            <Pressable
              onPress={handleClose}
              className="min-h-11 min-w-11 items-center justify-center px-2"
            >
              <Text className="text-text-secondary text-base font-medium">
                {dict.common.cancel}
              </Text>
            </Pressable>
            <Text className="text-text-primary text-base font-bold">
              {dict.customModal.title}
            </Text>
            <Pressable
              onPress={handleSave}
              disabled={saving}
              className="min-h-11 min-w-11 items-center justify-center px-2"
            >
              {saving ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <Text className="text-primary text-base font-bold">
                  {dict.common.save}
                </Text>
              )}
            </Pressable>
          </View>

          <ScrollView
            className="flex-1 px-4 pt-4"
            contentContainerStyle={{ paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Exercise Name */}
            <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-2">
              {dict.customModal.nameLabel}
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={dict.customModal.namePlaceholder}
              placeholderTextColor={Colors.textMuted}
              className="bg-surface border border-border rounded-xl px-4 py-3 text-text-primary text-base mb-4"
            />

            {/* Muscle Group Picker */}
            <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-2">
              {dict.customModal.muscleLabel}
            </Text>
            <View className="flex-row flex-wrap gap-2 mb-4">
              {MUSCLE_GROUPS.map((group) => {
                const selected = muscleGroup === group;
                return (
                  <Pressable
                    key={group}
                    onPress={() => setMuscleGroup(group)}
                    className={`min-h-11 px-4 rounded-xl border items-center justify-center ${
                      selected
                        ? "bg-primary-subtle border-primary"
                        : "bg-surface border-border"
                    }`}
                  >
                    <Text
                      className={`text-sm font-semibold ${
                        selected ? "text-primary" : "text-text-secondary"
                      }`}
                    >
                      {tMuscle(group)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Equipment */}
            <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-2">
              {dict.customModal.equipmentLabel}
            </Text>
            <TextInput
              value={equipment}
              onChangeText={setEquipment}
              placeholder={dict.customModal.equipmentPlaceholder}
              placeholderTextColor={Colors.textMuted}
              className="bg-surface border border-border rounded-xl px-4 py-3 text-text-primary text-base mb-4"
            />

            {/* Instructions */}
            <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-2">
              {dict.customModal.instructionsLabel}
            </Text>
            <TextInput
              value={instructionsText}
              onChangeText={setInstructionsText}
              placeholder={dict.customModal.instructionsPlaceholder}
              placeholderTextColor={Colors.textMuted}
              multiline
              textAlignVertical="top"
              className="bg-surface border border-border rounded-xl px-4 py-3 text-text-primary text-base min-h-28 mb-4"
            />

            {/* Personal Form Cue */}
            <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-2">
              {dict.customModal.tipsLabel}
            </Text>
            <TextInput
              value={tips}
              onChangeText={setTips}
              placeholder={dict.customModal.tipsPlaceholder}
              placeholderTextColor={Colors.textMuted}
              className="bg-surface border border-border rounded-xl px-4 py-3 text-text-primary text-base mb-4"
            />

            {/* Optional Video URL */}
            <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-2">
              {dict.customModal.videoLabel}
            </Text>
            <TextInput
              value={videoUrl}
              onChangeText={setVideoUrl}
              placeholder={dict.customModal.videoPlaceholder}
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              className="bg-surface border border-border rounded-xl px-4 py-3 text-text-primary text-base mb-6"
            />

            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={Shadows.card}
              className="min-h-12 bg-primary rounded-xl flex-row items-center justify-center gap-2"
            >
              <Ionicons name="checkmark-circle" size={20} color="#000000" />
              <Text className="text-black text-base font-extrabold">
                {saving ? dict.common.saving : dict.customModal.saveBtn}
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
