import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Colors } from "@/constants/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTintColor: Colors.textPrimary,
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textSecondary,
        sceneStyle: { backgroundColor: Colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Workout",
          tabBarIcon: ({ size, focused }) => (
            <Ionicons
              name={focused ? "barbell" : "barbell-outline"}
              size={size}
              color={focused ? Colors.primary : Colors.textSecondary}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: "Plan",
          tabBarIcon: ({ size, focused }) => (
            <Ionicons
              name={focused ? "calendar" : "calendar-outline"}
              size={size}
              color={focused ? Colors.primary : Colors.textSecondary}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="exercises"
        options={{
          title: "Exercises",
          tabBarIcon: ({ size, focused }) => (
            <Ionicons
              name={focused ? "library" : "library-outline"}
              size={size}
              color={focused ? Colors.primary : Colors.textSecondary}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          tabBarIcon: ({ size, focused }) => (
            <Ionicons
              name={focused ? "stats-chart" : "stats-chart-outline"}
              size={size}
              color={focused ? Colors.primary : Colors.textSecondary}
            />
          ),
        }}
      />
    </Tabs>
  );
}
