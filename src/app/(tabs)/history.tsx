import { Text, View } from "react-native";

export default function HistoryScreen() {
  return (
    <View className="flex-1 bg-background items-center justify-center p-6">
      <Text className="text-text-primary text-lg font-bold">
        Workout History
      </Text>
      <Text className="text-text-secondary text-sm mt-1">
        Module 5 will build weekly volume stats &amp; logs here.
      </Text>
    </View>
  );
}
