import { Pressable, Text, View } from "react-native";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";
import { Colors } from "@/constants/theme";
import type { MuscleGroupSummary } from "@/lib/smartCoach";

interface MuscleBodyMapProps {
  summaries: Record<string, MuscleGroupSummary>;
  selectedMuscle: string | null;
  onSelectMuscle: (muscle: string | null) => void;
}

export function MuscleBodyMap({
  summaries,
  selectedMuscle,
  onSelectMuscle,
}: MuscleBodyMapProps) {
  function getStyleProps(group: string) {
    const summary = summaries[group];
    const worked = (summary?.setsCount ?? 0) > 0;
    const isSelected = selectedMuscle === group;
    const intensity = summary?.intensity ?? 0;

    return {
      fill: worked ? Colors.primary : "#1F1F24",
      fillOpacity: worked ? 0.28 + intensity * 0.68 : 0.92,
      stroke: isSelected
        ? "#FFFFFF"
        : worked
          ? Colors.primary
          : "#383842",
      strokeWidth: isSelected ? 2 : 1,
    };
  }

  function toggleGroup(group: string) {
    onSelectMuscle(selectedMuscle === group ? null : group);
  }

  return (
    <View className="rounded-2xl bg-surface border border-border p-4 gap-3">
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="text-text-primary text-base font-bold">
            Anatomical Heatmap
          </Text>
          <Text className="text-text-secondary text-xs">
            Tap any muscle group to filter exercises &amp; recovery
          </Text>
        </View>
        {selectedMuscle && (
          <Pressable
            onPress={() => onSelectMuscle(null)}
            className="min-h-9 px-3 rounded-full bg-surface-elevated border border-border items-center justify-center"
          >
            <Text className="text-primary text-xs font-bold">Show All</Text>
          </Pressable>
        )}
      </View>

      <View className="flex-row items-center justify-around py-2">
        {/* FRONT VIEW */}
        <View className="items-center gap-1.5">
          <Svg width={132} height={264} viewBox="0 0 140 280">
            {/* Head & Neck */}
            <Circle
              cx={70}
              cy={24}
              r={14}
              fill="#1C1C22"
              stroke="#383842"
              strokeWidth={1.2}
            />
            <Rect
              x={62}
              y={37}
              width={16}
              height={11}
              rx={4}
              fill="#1C1C22"
              stroke="#383842"
              strokeWidth={1}
            />

            {/* Shoulders (Front Delts) */}
            <G onPress={() => toggleGroup("Shoulders")}>
              <Path
                d="M46 50 C34 50 28 58 28 70 L39 73 L45 58 Z"
                {...getStyleProps("Shoulders")}
              />
              <Path
                d="M94 50 C106 50 112 58 112 70 L101 73 L95 58 Z"
                {...getStyleProps("Shoulders")}
              />
            </G>

            {/* Chest (Pectorals) */}
            <G onPress={() => toggleGroup("Chest")}>
              <Path
                d="M45 50 L69 52 L69 78 C58 80 46 77 43 68 Z"
                {...getStyleProps("Chest")}
              />
              <Path
                d="M95 50 L71 52 L71 78 C82 80 94 77 97 68 Z"
                {...getStyleProps("Chest")}
              />
            </G>

            {/* Arms (Biceps & Forearms) */}
            <G onPress={() => toggleGroup("Arms")}>
              <Path
                d="M27 72 L39 74 L36 105 L24 103 Z"
                {...getStyleProps("Arms")}
              />
              <Path
                d="M23 107 L35 109 L30 142 L19 140 Z"
                {...getStyleProps("Arms")}
              />
              <Path
                d="M113 72 L101 74 L104 105 L116 103 Z"
                {...getStyleProps("Arms")}
              />
              <Path
                d="M117 107 L105 109 L110 142 L121 140 Z"
                {...getStyleProps("Arms")}
              />
            </G>

            {/* Core (Abs & Obliques) */}
            <G onPress={() => toggleGroup("Core")}>
              <Rect
                x={54}
                y={82}
                width={14}
                height={14}
                rx={3}
                {...getStyleProps("Core")}
              />
              <Rect
                x={72}
                y={82}
                width={14}
                height={14}
                rx={3}
                {...getStyleProps("Core")}
              />
              <Rect
                x={54}
                y={99}
                width={14}
                height={14}
                rx={3}
                {...getStyleProps("Core")}
              />
              <Rect
                x={72}
                y={99}
                width={14}
                height={14}
                rx={3}
                {...getStyleProps("Core")}
              />
              <Rect
                x={55}
                y={116}
                width={13}
                height={16}
                rx={3}
                {...getStyleProps("Core")}
              />
              <Rect
                x={72}
                y={116}
                width={13}
                height={16}
                rx={3}
                {...getStyleProps("Core")}
              />
              {/* Obliques */}
              <Path
                d="M44 76 L52 82 L52 128 L44 122 Z"
                {...getStyleProps("Core")}
              />
              <Path
                d="M96 76 L88 82 L88 128 L96 122 Z"
                {...getStyleProps("Core")}
              />
            </G>

            {/* Pelvis Base */}
            <Path
              d="M45 134 L95 134 L91 150 L74 153 L70 147 L66 153 L49 150 Z"
              fill="#1C1C22"
              stroke="#383842"
              strokeWidth={1}
            />

            {/* Legs (Quads & Calves) */}
            <G onPress={() => toggleGroup("Legs")}>
              <Path
                d="M46 152 L67 154 L64 205 L44 205 Z"
                {...getStyleProps("Legs")}
              />
              <Path
                d="M94 152 L73 154 L76 205 L96 205 Z"
                {...getStyleProps("Legs")}
              />
              <Path
                d="M45 210 L62 210 L59 262 L46 262 Z"
                {...getStyleProps("Legs")}
              />
              <Path
                d="M95 210 L78 210 L81 262 L94 262 Z"
                {...getStyleProps("Legs")}
              />
            </G>
          </Svg>
          <Text className="text-text-secondary text-[11px] font-bold uppercase tracking-wider">
            Front
          </Text>
        </View>

        {/* BACK VIEW */}
        <View className="items-center gap-1.5">
          <Svg width={132} height={264} viewBox="0 0 140 280">
            {/* Head & Neck */}
            <Circle
              cx={70}
              cy={24}
              r={14}
              fill="#1C1C22"
              stroke="#383842"
              strokeWidth={1.2}
            />
            <Rect
              x={62}
              y={37}
              width={16}
              height={11}
              rx={4}
              fill="#1C1C22"
              stroke="#383842"
              strokeWidth={1}
            />

            {/* Rear Shoulders */}
            <G onPress={() => toggleGroup("Shoulders")}>
              <Path
                d="M46 50 C34 50 28 58 28 70 L39 73 L45 58 Z"
                {...getStyleProps("Shoulders")}
              />
              <Path
                d="M94 50 C106 50 112 58 112 70 L101 73 L95 58 Z"
                {...getStyleProps("Shoulders")}
              />
            </G>

            {/* Back (Traps, Lats, Lower Back) */}
            <G onPress={() => toggleGroup("Back")}>
              {/* Traps */}
              <Path
                d="M54 46 L70 43 L86 46 L92 59 L70 72 L48 59 Z"
                {...getStyleProps("Back")}
              />
              {/* Left & Right Lats */}
              <Path
                d="M44 62 L68 74 L68 112 L50 108 L42 82 Z"
                {...getStyleProps("Back")}
              />
              <Path
                d="M96 62 L72 74 L72 112 L90 108 L98 82 Z"
                {...getStyleProps("Back")}
              />
              {/* Lower Back */}
              <Path
                d="M52 112 L88 112 L86 134 L54 134 Z"
                {...getStyleProps("Back")}
              />
            </G>

            {/* Arms (Triceps & Forearms) */}
            <G onPress={() => toggleGroup("Arms")}>
              <Path
                d="M27 72 L39 74 L36 105 L24 103 Z"
                {...getStyleProps("Arms")}
              />
              <Path
                d="M23 107 L35 109 L30 142 L19 140 Z"
                {...getStyleProps("Arms")}
              />
              <Path
                d="M113 72 L101 74 L104 105 L116 103 Z"
                {...getStyleProps("Arms")}
              />
              <Path
                d="M117 107 L105 109 L110 142 L121 140 Z"
                {...getStyleProps("Arms")}
              />
            </G>

            {/* Legs (Glutes, Hamstrings, Calves) */}
            <G onPress={() => toggleGroup("Legs")}>
              {/* Glutes */}
              <Path
                d="M48 136 L69 136 L68 158 C56 160 46 154 46 144 Z"
                {...getStyleProps("Legs")}
              />
              <Path
                d="M92 136 L71 136 L72 158 C84 160 94 154 94 144 Z"
                {...getStyleProps("Legs")}
              />
              {/* Hamstrings */}
              <Path
                d="M46 160 L67 160 L64 205 L44 205 Z"
                {...getStyleProps("Legs")}
              />
              <Path
                d="M94 160 L73 160 L76 205 L96 205 Z"
                {...getStyleProps("Legs")}
              />
              {/* Calves */}
              <Path
                d="M45 210 L62 210 L59 262 L46 262 Z"
                {...getStyleProps("Legs")}
              />
              <Path
                d="M95 210 L78 210 L81 262 L94 262 Z"
                {...getStyleProps("Legs")}
              />
            </G>
          </Svg>
          <Text className="text-text-secondary text-[11px] font-bold uppercase tracking-wider">
            Back
          </Text>
        </View>
      </View>

      {/* Legend */}
      <View className="flex-row items-center justify-center gap-5 pt-1 border-t border-border">
        <View className="flex-row items-center gap-1.5">
          <View className="w-3 h-3 rounded-sm bg-surface-elevated border border-border" />
          <Text className="text-text-secondary text-[11px]">Untrained</Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <View className="w-3 h-3 rounded-sm bg-primary/40 border border-primary" />
          <Text className="text-text-secondary text-[11px]">Light Volume</Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <View className="w-3 h-3 rounded-sm bg-primary" />
          <Text className="text-text-secondary text-[11px]">High Focus</Text>
        </View>
      </View>
    </View>
  );
}
