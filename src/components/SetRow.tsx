import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, TextInput, View } from "react-native";
import { Colors } from "@/constants/theme";
import type { DraftSetRow, SetType } from "@/types/database";

interface SetRowProps {
  row: DraftSetRow;
  onCycleType: () => void;
  onCopyPrevious: () => void;
  onChangeWeight: (val: string) => void;
  onChangeReps: (val: string) => void;
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
  onCycleType,
  onCopyPrevious,
  onChangeWeight,
  onChangeReps,
  onToggleComplete,
}: SetRowProps) {
  const badge = SET_BADGE[row.set_type];
  const hasPrevious =
    row.prev_weight_kg !== undefined && row.prev_reps !== undefined;

  return (
    <View
      className={`flex-row items-center gap-2 px-2 py-1.5 rounded-xl border ${
        row.is_completed
          ? "bg-primary-subtle border-primary/30"
          : "border-transparent"
      }`}
    >
      {/* Circular SmartGym Set Badge */}
      <Pressable
        onPress={onCycleType}
        className="min-h-11 min-w-11 items-center justify-center"
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
        className="flex-1 min-h-11 items-center justify-center px-1"
      >
        <Text
          numberOfLines={1}
          style={{ fontVariant: ["tabular-nums"] }}
          className={`text-xs font-medium ${
            hasPrevious ? "text-text-secondary" : "text-text-muted"
          }`}
        >
          {hasPrevious ? `${row.prev_weight_kg}kg × ${row.prev_reps}` : "—"}
        </Text>
      </Pressable>

      {/* KG Column */}
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
        selectTextOnFocus
        style={{ fontVariant: ["tabular-nums"] }}
        className="w-16 min-h-11 rounded-xl bg-surface-elevated border border-border text-text-primary text-sm font-bold text-center px-1.5"
      />

      {/* REPS Column */}
      <TextInput
        value={row.reps}
        onChangeText={(val) => onChangeReps(val.replace(/[^0-9]/g, ""))}
        placeholder={row.prev_reps !== undefined ? String(row.prev_reps) : "0"}
        placeholderTextColor={Colors.textMuted}
        keyboardType="number-pad"
        selectTextOnFocus
        style={{ fontVariant: ["tabular-nums"] }}
        className="w-14 min-h-11 rounded-xl bg-surface-elevated border border-border text-text-primary text-sm font-bold text-center px-1.5"
      />

      {/* CHECKMARK Column */}
      <Pressable
        onPress={onToggleComplete}
        className={`min-h-11 min-w-11 rounded-xl border items-center justify-center ${
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
  );
}
