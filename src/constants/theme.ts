import { Platform, type ViewStyle } from "react-native";

export const Colors = {
  background: "#0B0F17",
  surface: "#161C28",
  surfaceElevated: "#1E2638",
  mediaFrame: "#F3F4F6",
  primary: "#10B981",
  primarySubtle: "rgba(16, 185, 129, 0.14)",
  accent: "#3B82F6",
  warning: "#F59E0B",
  purple: "#A855F7",
  danger: "#EF4444",
  textPrimary: "#F9FAFB",
  textSecondary: "#9CA3AF",
  textMuted: "#4B5563",
  border: "#263042",
} as const;

export const TouchTarget = {
  minSize: 44,
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 9999,
} as const;

export const Shadows: { card: ViewStyle } = {
  card:
    Platform.select<ViewStyle>({
      ios: {
        shadowColor: "#000000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
      default: {},
    }) ?? {},
};
