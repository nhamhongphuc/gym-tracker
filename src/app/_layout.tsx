import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Colors } from "@/constants/theme";
import { LanguageProvider, useI18n } from "@/i18n/LanguageContext";

function RootNavigator() {
  const { dict } = useI18n();

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.surface },
          headerTintColor: Colors.textPrimary,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: Colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="exercise/[id]"
          options={{
            presentation: "modal",
            title: dict.exerciseDetail.defaultTitle,
          }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <LanguageProvider>
      <RootNavigator />
    </LanguageProvider>
  );
}
