import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { Colors, Shadows } from "@/constants/theme";
import { useI18n } from "@/i18n/LanguageContext";

interface RestTimerBarProps {
  remainingSeconds: number;
  totalSeconds: number;
  exerciseName?: string;
  onAdjust: (deltaSeconds: number) => void;
  onSkip: () => void;
}

function formatTime(seconds: number): string {
  const clamped = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function RestTimerBar({
  remainingSeconds,
  totalSeconds,
  exerciseName,
  onAdjust,
  onSkip,
}: RestTimerBarProps) {
  const { dict } = useI18n();
  const progress =
    totalSeconds > 0
      ? Math.min(1, Math.max(0, remainingSeconds / totalSeconds))
      : 0;
  const isDone = remainingSeconds <= 0;

  return (
    <View
      style={Shadows.card}
      className="mx-3 mb-2 rounded-2xl bg-surface-elevated border border-border px-4 pt-2.5 pb-3"
    >
      {/* Linear Progress Track */}
      <View className="h-1.5 w-full rounded-full bg-background overflow-hidden mb-2.5">
        <View
          className={`h-full rounded-full ${isDone ? "bg-primary" : "bg-accent"}`}
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </View>

      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-1">
          <View className="flex-row items-center gap-1.5">
            <Ionicons
              name={isDone ? "checkmark-circle" : "timer-outline"}
              size={18}
              color={isDone ? Colors.primary : Colors.accent}
            />
            <Text
              style={{ fontVariant: ["tabular-nums"] }}
              className={`text-lg font-extrabold ${
                isDone ? "text-primary" : "text-text-primary"
              }`}
            >
              {isDone ? dict.restTimer.complete : formatTime(remainingSeconds)}
            </Text>
          </View>
          {!!exerciseName && (
            <Text numberOfLines={1} className="text-text-secondary text-xs">
              {exerciseName}
            </Text>
          )}
        </View>

        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => onAdjust(-15)}
            accessibilityRole="button"
            accessibilityLabel="Subtract 15 seconds"
            className="min-h-11 min-w-11 px-2.5 rounded-xl bg-surface border border-border items-center justify-center active:opacity-75"
          >
            <Text className="text-text-primary text-xs font-bold">-15s</Text>
          </Pressable>
          <Pressable
            onPress={() => onAdjust(15)}
            accessibilityRole="button"
            accessibilityLabel="Add 15 seconds"
            className="min-h-11 min-w-11 px-2.5 rounded-xl bg-surface border border-border items-center justify-center active:opacity-75"
          >
            <Text className="text-text-primary text-xs font-bold">+15s</Text>
          </Pressable>
          <Pressable
            onPress={onSkip}
            accessibilityRole="button"
            accessibilityLabel="Skip rest timer"
            className="min-h-11 min-w-11 px-3.5 rounded-xl bg-primary items-center justify-center active:opacity-75"
          >
            <Text className="text-black text-xs font-extrabold">
              {dict.restTimer.skip}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
