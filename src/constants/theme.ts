import { Platform, type ViewStyle } from "react-native";

export const Colors = {
  background: "#000000",
  surface: "#141417",
  surfaceElevated: "#1F1F24",
  mediaFrame: "#F4F4F5",
  primary: "#9EFF00",
  primarySubtle: "rgba(158, 255, 0, 0.14)",
  accent: "#0A84FF",
  warning: "#FFD60A",
  purple: "#BF5AF2",
  danger: "#FF375F",
  textPrimary: "#FFFFFF",
  textSecondary: "#8E8E93",
  textMuted: "#48484A",
  border: "#26262B",
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
        shadowOpacity: 0.35,
        shadowRadius: 6,
      },
      android: {
        elevation: 4,
      },
      default: {},
    }) ?? {},
};
