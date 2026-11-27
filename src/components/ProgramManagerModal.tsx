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
import { formatTemplate, useI18n } from "@/i18n/LanguageContext";
import {
  createCustomProgram,
  createProgramFromPreset,
  deleteProgram,
  fetchExercises,
  fetchPrograms,
  setActiveProgram,
  updateProgramMeta,
} from "@/lib/api";
import {
  PROGRAM_PRESETS,
  type ProgramPresetKey,
} from "@/lib/programTemplates";
import type { ScheduleMode, WorkoutProgram } from "@/types/database";

type ModalTab = "saved" | "presets" | "custom";

interface ProgramManagerModalProps {
  visible: boolean;
  programs: WorkoutProgram[];
  onClose: () => void;
  onProgramsChanged: (updated: WorkoutProgram[]) => void;
}

export function ProgramManagerModal({
  visible,
  programs,
  onClose,
  onProgramsChanged,
}: ProgramManagerModalProps) {
  const { locale, dict } = useI18n();
  const [activeTab, setActiveTab] = useState<ModalTab>("saved");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [customName, setCustomName] = useState("");
  const [customDesc, setCustomDesc] = useState("");
  const [customMode, setCustomMode] = useState<ScheduleMode>("rolling");
  const [slotCount, setSlotCount] = useState(4);

  async function refreshAndEmit() {
    const fresh = await fetchPrograms();
    onProgramsChanged(fresh);
  }

  async function handleActivate(programId: string) {
    setBusyKey(`act_${programId}`);
    try {
      await setActiveProgram(programId);
      await refreshAndEmit();
      onClose();
    } catch (err) {
      Alert.alert(
        dict.programsModal.actionFailedTitle,
        err instanceof Error
          ? err.message
          : dict.programsModal.actionFailedBody
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleToggleMode(program: WorkoutProgram) {
    const nextMode: ScheduleMode =
      program.schedule_mode === "rolling" ? "weekly" : "rolling";
    setBusyKey(`mode_${program.id}`);
    try {
      await updateProgramMeta(program.id, { schedule_mode: nextMode });
      await refreshAndEmit();
    } catch (err) {
      Alert.alert(
        dict.programsModal.actionFailedTitle,
        err instanceof Error
          ? err.message
          : dict.programsModal.actionFailedBody
      );
    } finally {
      setBusyKey(null);
    }
  }

  function confirmDelete(program: WorkoutProgram) {
    Alert.alert(
      dict.programsModal.deleteTitle,
      formatTemplate(dict.programsModal.deleteConfirm, { name: program.name }),
      [
        { text: dict.common.cancel, style: "cancel" },
        {
          text: dict.common.delete,
          style: "destructive",
          onPress: async () => {
            setBusyKey(`del_${program.id}`);
            try {
              await deleteProgram(program.id);
              await refreshAndEmit();
            } catch (err) {
              Alert.alert(
                dict.programsModal.actionFailedTitle,
                err instanceof Error
                  ? err.message
                  : dict.programsModal.actionFailedBody
              );
            } finally {
              setBusyKey(null);
            }
          },
        },
      ]
    );
  }

  async function handleCreatePreset(presetKey: ProgramPresetKey) {
    setBusyKey(`preset_${presetKey}`);
    try {
      const catalog = await fetchExercises();
      await createProgramFromPreset(presetKey, catalog, "rolling");
      await refreshAndEmit();
      setActiveTab("saved");
      onClose();
    } catch (err) {
      Alert.alert(
        dict.programsModal.actionFailedTitle,
        err instanceof Error
          ? err.message
          : dict.programsModal.actionFailedBody
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCreateCustom() {
    if (!customName.trim()) {
      Alert.alert(
        dict.programsModal.missingNameTitle,
        dict.programsModal.missingNameBody
      );
      return;
    }

    setBusyKey("custom_create");
    try {
      await createCustomProgram({
        name: customName.trim(),
        description: customDesc.trim() || undefined,
        scheduleMode: customMode,
        routineCount: slotCount,
      });
      await refreshAndEmit();
      setCustomName("");
      setCustomDesc("");
      setCustomMode("rolling");
      setSlotCount(4);
      setActiveTab("saved");
      onClose();
    } catch (err) {
      Alert.alert(
        dict.programsModal.actionFailedTitle,
        err instanceof Error
          ? err.message
          : dict.programsModal.actionFailedBody
      );
    } finally {
      setBusyKey(null);
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
        <View className="flex-row items-center justify-between px-4 py-3 bg-surface border-b border-border">
          <Text className="text-text-primary text-lg font-extrabold">
            {dict.programsModal.title}
          </Text>
          <Pressable
            onPress={onClose}
            className="min-h-11 min-w-11 items-center justify-center px-2"
          >
            <Text className="text-primary text-base font-bold">
              {dict.common.done}
            </Text>
          </Pressable>
        </View>

        {/* Segmented Control */}
        <View className="px-4 pt-3 pb-2 bg-surface border-b border-border">
          <View className="flex-row bg-surface-elevated rounded-xl p-1 border border-border">
            {(
              [
                { key: "saved", label: dict.programsModal.tabSaved },
                { key: "presets", label: dict.programsModal.tabPresets },
                { key: "custom", label: dict.programsModal.tabCustom },
              ] as const
            ).map((tab) => {
              const selected = activeTab === tab.key;
              return (
                <Pressable
                  key={tab.key}
                  onPress={() => setActiveTab(tab.key)}
                  className={`flex-1 min-h-10 rounded-lg items-center justify-center ${
                    selected ? "bg-primary" : ""
                  }`}
                >
                  <Text
                    className={`text-xs font-extrabold ${
                      selected ? "text-black" : "text-text-secondary"
                    }`}
                  >
                    {tab.label}
                  </Text>
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
            contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
          >
            {activeTab === "saved" &&
              programs.map((prog) => {
                const routinesCount = prog.workout_plans?.length ?? 0;
                const isBusy =
                  busyKey === `act_${prog.id}` ||
                  busyKey === `mode_${prog.id}` ||
                  busyKey === `del_${prog.id}`;

                return (
                  <View
                    key={prog.id}
                    style={Shadows.card}
                    className={`rounded-2xl bg-surface border p-4 gap-3 ${
                      prog.is_active ? "border-primary" : "border-border"
                    }`}
                  >
                    <View className="flex-row items-start justify-between gap-2">
                      <View className="flex-1 gap-1">
                        <View className="flex-row items-center gap-2 flex-wrap">
                          <Text className="text-text-primary text-base font-extrabold">
                            {prog.name}
                          </Text>
                          {prog.is_active && (
                            <View className="px-2 py-0.5 rounded-full bg-primary">
                              <Text className="text-black text-[10px] font-extrabold">
                                {dict.programsModal.activeBadge}
                              </Text>
                            </View>
                          )}
                        </View>
                        {!!prog.description && (
                          <Text className="text-text-secondary text-xs">
                            {prog.description}
                          </Text>
                        )}
                      </View>

                      {programs.length > 1 && (
                        <Pressable
                          onPress={() => confirmDelete(prog)}
                          disabled={Boolean(busyKey)}
                          className="min-h-10 min-w-10 rounded-xl bg-surface-elevated border border-border items-center justify-center"
                        >
                          <Ionicons
                            name="trash-outline"
                            size={18}
                            color={Colors.danger}
                          />
                        </Pressable>
                      )}
                    </View>

                    <View className="flex-row items-center justify-between gap-2">
                      <View className="flex-row items-center gap-2">
                        <Pressable
                          onPress={() => handleToggleMode(prog)}
                          disabled={Boolean(busyKey)}
                          className="px-3 py-1.5 rounded-full bg-surface-elevated border border-border flex-row items-center gap-1.5"
                        >
                          <Ionicons
                            name={
                              prog.schedule_mode === "rolling"
                                ? "repeat"
                                : "calendar-outline"
                            }
                            size={13}
                            color={Colors.primary}
                          />
                          <Text className="text-text-primary text-xs font-bold">
                            {prog.schedule_mode === "rolling"
                              ? dict.workout.rollingMode
                              : dict.workout.weeklyMode}
                          </Text>
                        </Pressable>
                        <Text className="text-text-muted text-xs font-medium">
                          {formatTemplate(dict.programsModal.routinesCount, {
                            count: routinesCount,
                          })}
                        </Text>
                      </View>

                      {!prog.is_active && (
                        <Pressable
                          onPress={() => handleActivate(prog.id)}
                          disabled={Boolean(busyKey)}
                          className="min-h-10 px-4 rounded-full bg-primary items-center justify-center"
                        >
                          {isBusy ? (
                            <ActivityIndicator size="small" color="#000000" />
                          ) : (
                            <Text className="text-black text-xs font-extrabold">
                              {dict.programsModal.activateBtn}
                            </Text>
                          )}
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              })}

            {activeTab === "presets" && (
              <View className="gap-3">
                <Text className="text-text-secondary text-xs">
                  {dict.programsModal.presetHint}
                </Text>

                {PROGRAM_PRESETS.map((preset) => {
                  const isCreating = busyKey === `preset_${preset.key}`;
                  return (
                    <View
                      key={preset.key}
                      style={Shadows.card}
                      className="rounded-2xl bg-surface border border-border p-4 gap-3"
                    >
                      <View className="gap-1">
                        <Text className="text-text-primary text-base font-extrabold">
                          {locale === "vi" ? preset.nameVi : preset.name}
                        </Text>
                        <Text className="text-text-secondary text-xs">
                          {locale === "vi"
                            ? preset.descriptionVi
                            : preset.description}
                        </Text>
                      </View>

                      <View className="flex-row flex-wrap gap-1.5">
                        {preset.routines.map((r, rIdx) => (
                          <View
                            key={`${preset.key}_${rIdx}`}
                            className="px-2.5 py-1 rounded-full bg-surface-elevated border border-border"
                          >
                            <Text className="text-primary text-[11px] font-bold">
                              {r.short_label}
                            </Text>
                          </View>
                        ))}
                      </View>

                      <Pressable
                        onPress={() => handleCreatePreset(preset.key)}
                        disabled={Boolean(busyKey)}
                        className="min-h-11 rounded-xl bg-primary flex-row items-center justify-center gap-2"
                      >
                        {isCreating ? (
                          <>
                            <ActivityIndicator size="small" color="#000000" />
                            <Text className="text-black text-xs font-extrabold">
                              {dict.programsModal.creatingPreset}
                            </Text>
                          </>
                        ) : (
                          <>
                            <Ionicons
                              name="flash-outline"
                              size={16}
                              color="#000000"
                            />
                            <Text className="text-black text-xs font-extrabold">
                              {dict.programsModal.usePresetBtn}
                            </Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}

            {activeTab === "custom" && (
              <View
                style={Shadows.card}
                className="rounded-2xl bg-surface border border-border p-4 gap-4"
              >
                <View className="gap-1.5">
                  <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider">
                    {dict.programsModal.customNameLabel}
                  </Text>
                  <TextInput
                    value={customName}
                    onChangeText={setCustomName}
                    placeholder={dict.programsModal.customNamePlaceholder}
                    placeholderTextColor={Colors.textMuted}
                    className="bg-surface-elevated border border-border rounded-xl px-3.5 py-3 text-text-primary text-sm"
                  />
                </View>

                <View className="gap-1.5">
                  <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider">
                    {dict.programsModal.customDescLabel}
                  </Text>
                  <TextInput
                    value={customDesc}
                    onChangeText={setCustomDesc}
                    placeholder={dict.programsModal.customDescPlaceholder}
                    placeholderTextColor={Colors.textMuted}
                    className="bg-surface-elevated border border-border rounded-xl px-3.5 py-3 text-text-primary text-sm"
                  />
                </View>

                <View className="gap-2">
                  <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider">
                    {dict.programsModal.scheduleModeLabel}
                  </Text>
                  <View className="flex-row gap-2">
                    {(["rolling", "weekly"] as const).map((mode) => {
                      const selected = customMode === mode;
                      return (
                        <Pressable
                          key={mode}
                          onPress={() => setCustomMode(mode)}
                          className={`flex-1 rounded-xl border p-3 gap-1 ${
                            selected
                              ? "bg-primary-subtle border-primary"
                              : "bg-surface-elevated border-border"
                          }`}
                        >
                          <Text
                            className={`text-xs font-extrabold ${
                              selected ? "text-primary" : "text-text-primary"
                            }`}
                          >
                            {mode === "rolling"
                              ? dict.workout.rollingMode
                              : dict.workout.weeklyMode}
                          </Text>
                          <Text className="text-text-secondary text-[11px]">
                            {mode === "rolling"
                              ? dict.programsModal.rollingDesc
                              : dict.programsModal.weeklyDesc}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                {customMode === "rolling" && (
                  <View className="gap-2">
                    <Text className="text-text-secondary text-xs font-semibold uppercase tracking-wider">
                      {dict.programsModal.slotsLabel}
                    </Text>
                    <View className="flex-row gap-2">
                      {[2, 3, 4, 5, 6].map((n) => {
                        const selected = slotCount === n;
                        return (
                          <Pressable
                            key={n}
                            onPress={() => setSlotCount(n)}
                            className={`flex-1 min-h-11 rounded-xl border items-center justify-center ${
                              selected
                                ? "bg-primary border-primary"
                                : "bg-surface-elevated border-border"
                            }`}
                          >
                            <Text
                              className={`text-sm font-extrabold ${
                                selected ? "text-black" : "text-text-secondary"
                              }`}
                            >
                              {n}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                )}

                <Pressable
                  onPress={handleCreateCustom}
                  disabled={Boolean(busyKey)}
                  className="min-h-12 rounded-xl bg-primary items-center justify-center mt-1"
                >
                  {busyKey === "custom_create" ? (
                    <ActivityIndicator size="small" color="#000000" />
                  ) : (
                    <Text className="text-black text-sm font-extrabold">
                      {dict.programsModal.createCustomBtn}
                    </Text>
                  )}
                </Pressable>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
