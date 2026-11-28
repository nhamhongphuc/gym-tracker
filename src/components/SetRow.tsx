import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, TextInput, View } from "react-native";
import { Colors } from "@/constants/theme";
import { useI18n } from "@/i18n/LanguageContext";
import { formatSetSummary } from "@/lib/exerciseUnits";
import type { DraftSetRow, SetType } from "@/types/database";

interface SetRowProps {
  row: DraftSetRow;
  isCardio?: boolean;
  onCycleType: () => void;
  onCopyPrevious: () => void;
  onChangeWeight: (val: string) => void;
  onChangeReps: (val: string) => void;
  onChangeSpeed?: (val: string) => void;
  onChangeIncline?: (val: string) => void;
  onToggleComplete: () => void;
}

const SET_BADGE: Record<
  SetType,
  { label?: string; bgClass: string; textClass: string }
> = {
  working: {
    bgClass: "bg-surface-elevated border-border",
    textClass: "text-text-primary",
  },
  warmup: {
    label: "W",
    bgClass: "bg-warning/20 border-warning",
    textClass: "text-warning",
  },
  dropset: {
    label: "D",
    bgClass: "bg-purple/20 border-purple",
    textClass: "text-purple",
  },
  failure: {
    label: "F",
    bgClass: "bg-danger/20 border-danger",
    textClass: "text-danger",
  },
};

export function SetRow({
  row,
  isCardio = false,
  onCycleType,
  onCopyPrevious,
  onChangeWeight,
  onChangeReps,
  onChangeSpeed,
  onChangeIncline,
  onToggleComplete,
}: SetRowProps) {
  const { dict } = useI18n();
  const badge = SET_BADGE[row.set_type];
  const hasPrevious =
    row.prev_weight_kg !== undefined && row.prev_reps !== undefined;
  const prevText = hasPrevious
    ? formatSetSummary(
        row.prev_weight_kg!,
        row.prev_reps!,
        isCardio,
        row.prev_speed_kmh,
        row.prev_incline_pct
      )
    : "—";

  return (
    <View
      className={`gap-2 px-2 py-1.5 rounded-xl border ${
        row.is_completed
          ? "bg-primary-subtle border-primary/30"
          : "border-transparent"
      }`}
    >
      <View className="flex-row items-center gap-2">
        {/* Circular SmartGym Set Badge */}
        <Pressable
          onPress={onCycleType}
          accessibilityRole="button"
          accessibilityLabel={`Set ${row.set_number} type`}
          className="min-h-11 min-w-11 items-center justify-center active:opacity-75"
        >
          <View
            className={`w-9 h-9 rounded-full border items-center justify-center ${
              row.is_completed
                ? "bg-primary border-primary"
                : badge.bgClass
            }`}
          >
            <Text
              style={{ fontVariant: ["tabular-nums"] }}
              className={`text-sm font-extrabold ${
                row.is_completed ? "text-black" : badge.textClass
              }`}
            >
              {badge.label ?? String(row.set_number)}
            </Text>
          </View>
        </Pressable>

        {/* PREVIOUS Column (tap to prefill) */}
        <Pressable
          onPress={onCopyPrevious}
          disabled={!hasPrevious}
          accessibilityRole="button"
          accessibilityLabel={
            hasPrevious ? `Copy previous ${prevText}` : "No previous set"
          }
          className="flex-1 min-h-11 items-center justify-center px-1 active:opacity-75"
        >
          <Text
            numberOfLines={isCardio ? 2 : 1}
            style={{ fontVariant: ["tabular-nums"] }}
            className={`text-xs font-medium text-center ${
              hasPrevious ? "text-text-secondary" : "text-text-muted"
            }`}
          >
            {prevText}
          </Text>
        </Pressable>

        {/* KG / KM Column */}
        <TextInput
          value={row.weight_kg}
          onChangeText={(val) =>
            onChangeWeight(val.replace(",", ".").replace(/[^0-9.]/g, ""))
          }
          placeholder={
            row.prev_weight_kg !== undefined ? String(row.prev_weight_kg) : "0"
          }
          placeholderTextColor={Colors.textMuted}
          keyboardType="decimal-pad"
          accessibilityLabel={isCardio ? "Distance in km" : "Weight in kg"}
          selectTextOnFocus
          style={{ fontVariant: ["tabular-nums"] }}
          className="w-16 min-h-11 rounded-xl bg-surface-elevated border border-border text-text-primary text-sm font-bold text-center px-1.5"
        />

        {/* REPS / MIN Column */}
        <TextInput
          value={row.reps}
          onChangeText={(val) => onChangeReps(val.replace(/[^0-9]/g, ""))}
          placeholder={row.prev_reps !== undefined ? String(row.prev_reps) : "0"}
          placeholderTextColor={Colors.textMuted}
          keyboardType="number-pad"
          accessibilityLabel={isCardio ? "Duration in minutes" : "Reps"}
          selectTextOnFocus
          style={{ fontVariant: ["tabular-nums"] }}
          className="w-14 min-h-11 rounded-xl bg-surface-elevated border border-border text-text-primary text-sm font-bold text-center px-1.5"
        />

        {/* CHECKMARK Column */}
        <Pressable
          onPress={onToggleComplete}
          accessibilityRole="button"
          accessibilityLabel={`Mark set ${row.set_number} ${row.is_completed ? "incomplete" : "complete"}`}
          accessibilityState={{ checked: row.is_completed }}
          className={`min-h-11 min-w-11 rounded-xl border items-center justify-center active:opacity-75 ${
            row.is_completed
              ? "bg-primary border-primary"
              : "bg-surface-elevated border-border"
          }`}
        >
          <Ionicons
            name="checkmark"
            size={20}
            color={row.is_completed ? "#000000" : Colors.textSecondary}
          />
        </Pressable>
      </View>

      {isCardio && (
        <View className="flex-row items-center gap-2">
          <View className="flex-1 min-h-11 rounded-xl bg-surface-elevated border border-border flex-row items-center px-2.5 gap-2">
            <Text className="text-text-muted text-[11px] font-bold">
              {dict.workout.colSpeed}
            </Text>
            <TextInput
              value={row.speed_kmh ?? ""}
              onChangeText={(val) =>
                onChangeSpeed?.(val.replace(",", ".").replace(/[^0-9.]/g, ""))
              }
              placeholder={
                row.prev_speed_kmh != null ? String(row.prev_speed_kmh) : "0"
              }
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
              accessibilityLabel="Speed in km/h"
              selectTextOnFocus
              style={{ fontVariant: ["tabular-nums"] }}
              className="flex-1 text-text-primary text-sm font-bold text-right py-2"
            />
          </View>

          <View className="flex-1 min-h-11 rounded-xl bg-surface-elevated border border-border flex-row items-center px-2.5 gap-2">
            <Text className="text-text-muted text-[11px] font-bold">
              {dict.workout.colIncline}
            </Text>
            <TextInput
              value={row.incline_pct ?? ""}
              onChangeText={(val) =>
                onChangeIncline?.(val.replace(",", ".").replace(/[^0-9.]/g, ""))
              }
              placeholder={
                row.prev_incline_pct != null
                  ? String(row.prev_incline_pct)
                  : "0"
              }
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
              accessibilityLabel="Incline percent"
              selectTextOnFocus
              style={{ fontVariant: ["tabular-nums"] }}
              className="flex-1 text-text-primary text-sm font-bold text-right py-2"
            />
          </View>
        </View>
      )}
    </View>
  );
}
