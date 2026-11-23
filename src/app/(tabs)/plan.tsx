import { Text, View } from "react-native";

export default function PlanScreen() {
  return (
    <View className="flex-1 bg-background items-center justify-center p-6">
      <Text className="text-text-primary text-lg font-bold">
        Weekly Split Plan
      </Text>
      <Text className="text-text-secondary text-sm mt-1">
        Module 4 will build the Mon–Sun split builder here.
      </Text>
    </View>
  );
}
