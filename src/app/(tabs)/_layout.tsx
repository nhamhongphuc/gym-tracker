import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Colors } from "@/constants/theme";
import { useI18n } from "@/i18n/LanguageContext";

export default function TabsLayout() {
  const { dict } = useI18n();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        sceneStyle: { backgroundColor: Colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: dict.tabs.workout,
          tabBarIcon: ({ size, focused }) => (
            <Ionicons
              name={focused ? "barbell" : "barbell-outline"}
              size={size}
              color={focused ? Colors.primary : Colors.textMuted}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: dict.tabs.plan,
          tabBarIcon: ({ size, focused }) => (
            <Ionicons
              name={focused ? "calendar" : "calendar-outline"}
              size={size}
              color={focused ? Colors.primary : Colors.textMuted}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="exercises"
        options={{
          title: dict.tabs.exercises,
          tabBarIcon: ({ size, focused }) => (
            <Ionicons
              name={focused ? "library" : "library-outline"}
              size={size}
              color={focused ? Colors.primary : Colors.textMuted}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: dict.tabs.history,
          tabBarIcon: ({ size, focused }) => (
            <Ionicons
              name={focused ? "stats-chart" : "stats-chart-outline"}
              size={size}
              color={focused ? Colors.primary : Colors.textMuted}
            />
          ),
        }}
      />
    </Tabs>
  );
}
