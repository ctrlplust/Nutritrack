import { Feather } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNutri } from "@/context/NutriContext";

export default function ScaleToast() {
  const { scaleToast, clearScaleToast } = useNutri();
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-50)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!scaleToast) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: -50, duration: 200, useNativeDriver: true }),
      ]).start();
      return;
    }

    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      clearScaleToast();
    }, 4000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [scaleToast]);

  if (!scaleToast) return null;

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { top: insets.top + 8, opacity, transform: [{ translateY }] },
      ]}
    >
      <Pressable style={styles.card} onPress={clearScaleToast}>
        <View style={styles.header}>
          <Feather name="check-circle" size={18} color="#2E7D32" />
          <Text style={styles.title}>Consumo registrado</Text>
          <Pressable onPress={clearScaleToast} hitSlop={8}>
            <Feather name="x" size={16} color="#999" />
          </Pressable>
        </View>

        <Text style={styles.productName}>{scaleToast.productName}</Text>

        <View style={styles.metrics}>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>-{scaleToast.weightConsumedG}g</Text>
            <Text style={styles.metricLabel}>consumido</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{scaleToast.calories}</Text>
            <Text style={styles.metricLabel}>kcal</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{scaleToast.protein}g</Text>
            <Text style={styles.metricLabel}>proteína</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{scaleToast.carbs}g</Text>
            <Text style={styles.metricLabel}>carbs</Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{scaleToast.fat}g</Text>
            <Text style={styles.metricLabel}>grasa</Text>
          </View>
        </View>

        {scaleToast.weightBefore != null && (
          <View style={styles.weightRow}>
            <Text style={styles.weightText}>
              Peso inicial: {scaleToast.weightBefore}g → {scaleToast.weightAfter ?? 0}g
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 9999,
    elevation: 10,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#2E7D32",
  },
  productName: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#1a1a1a",
  },
  metrics: {
    flexDirection: "row",
    gap: 12,
  },
  metric: {
    alignItems: "center",
    gap: 2,
  },
  metricValue: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: "#1a1a1a",
  },
  metricLabel: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: "#888",
  },
  weightRow: {
    backgroundColor: "#F5F5F5",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
  },
  weightText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "#555",
  },
});
