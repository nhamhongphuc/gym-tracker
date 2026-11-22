import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { Colors, Shadows } from "@/constants/theme";

export default function Index() {
  return (
    <View className="flex-1 bg-background items-center justify-center p-6">
      <View
        className="w-full rounded-2xl bg-surface border border-border p-6 items-center gap-3"
        style={Shadows.card}
      >
        <Ionicons name="barbell-outline" size={36} color={Colors.primary} />
        <Text className="text-text-primary text-xl font-bold">
          Gym Tracker Ready
        </Text>
        <Text className="text-text-secondary text-sm text-center">
          Uniwind (Tailwind v4) + Dark Theme tokens are active on iOS &amp; Android.
        </Text>
        <View className="mt-2 min-h-11 px-4 rounded-xl bg-primary-subtle border border-primary items-center justify-center">
          <Text className="text-primary font-semibold text-sm">
            Phase 1 Smoke Test Passed
          </Text>
        </View>
      </View>
    </View>
  );
}
