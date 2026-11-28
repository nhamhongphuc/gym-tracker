import { Pressable, Text, View } from "react-native";
import { useI18n } from "@/i18n/LanguageContext";

export function LanguageToggle() {
  const { locale, toggleLocale } = useI18n();
  const nextLocale = locale === "en" ? "vi" : "en";

  return (
    <Pressable
      onPress={toggleLocale}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={`Switch language to ${nextLocale.toUpperCase()}`}
      className="min-h-11 justify-center active:opacity-75"
    >
      <View className="flex-row items-center rounded-full bg-surface-elevated border border-border p-0.5">
        <View
          className={`px-2.5 py-1 rounded-full ${
            locale === "en" ? "bg-primary" : ""
          }`}
        >
          <Text
            className={`text-[11px] font-extrabold ${
              locale === "en" ? "text-black" : "text-text-secondary"
            }`}
          >
            EN
          </Text>
        </View>
        <View
          className={`px-2.5 py-1 rounded-full ${
            locale === "vi" ? "bg-primary" : ""
          }`}
        >
          <Text
            className={`text-[11px] font-extrabold ${
              locale === "vi" ? "text-black" : "text-text-secondary"
            }`}
          >
            VI
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
