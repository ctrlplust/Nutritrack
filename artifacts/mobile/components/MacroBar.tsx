import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface MacroBarProps {
  label: string;
  current: number;
  goal: number;
  color: string;
  unit?: string;
}

export function MacroBar({ label, current, current: _, goal, color, unit = "g" }: MacroBarProps) {
  const colors = useColors();
  const pct = goal > 0 ? Math.min(current / goal, 1) : 0;
  const over = current > goal;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.value, { color: over ? colors.destructive : colors.foreground }]}>
          {Math.round(current)}<Text style={[styles.unit, { color: colors.mutedForeground }]}>{unit}</Text>
          <Text style={[styles.goal, { color: colors.mutedForeground }]}> / {goal}{unit}</Text>
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View
          style={[
            styles.fill,
            {
              width: `${pct * 100}%`,
              backgroundColor: over ? colors.destructive : color,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  value: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  unit: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  goal: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  fill: {
    height: 8,
    borderRadius: 4,
  },
});
