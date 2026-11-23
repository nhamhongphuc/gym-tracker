import { Text, View } from "react-native";

export default function WorkoutScreen() {
  return (
    <View className="flex-1 bg-background items-center justify-center p-6">
      <Text className="text-text-primary text-lg font-bold">
        Today&apos;s Workout
      </Text>
      <Text className="text-text-secondary text-sm mt-1">
        Module 5 will build the active set logger here.
      </Text>
    </View>
  );
}
