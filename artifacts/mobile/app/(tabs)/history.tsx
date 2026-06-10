import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useMemo, useState } from "react";
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNutri, type Consumption } from "@/context/NutriContext";
import { useColors } from "@/hooks/useColors";

type Filter = "today" | "week" | "month";

function groupByDate(items: Consumption[]) {
  const groups: Record<string, Consumption[]> = {};
  items.forEach((c) => {
    const day = new Date(c.timestamp).toDateString();
    if (!groups[day]) groups[day] = [];
    groups[day].push(c);
  });
  return Object.entries(groups).sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime());
}

function formatDay(dateStr: string) {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === yesterday.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" });
}

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { consumptions, currentProfile, deleteConsumption } = useNutri();
  const [filter, setFilter] = useState<Filter>("today");

  const filtered = useMemo(() => {
    const now = new Date();
    return consumptions.filter((c) => {
      if (c.profileId !== currentProfile?.id) return false;
      const d = new Date(c.timestamp);
      if (filter === "today") return d.toDateString() === now.toDateString();
      if (filter === "week") {
        const week = new Date(now);
        week.setDate(now.getDate() - 7);
        return d >= week;
      }
      if (filter === "month") {
        const month = new Date(now);
        month.setMonth(now.getMonth() - 1);
        return d >= month;
      }
      return true;
    });
  }, [consumptions, filter, currentProfile]);

  const grouped = groupByDate(filtered);

  const totals = filtered.reduce(
    (acc, c) => ({ cal: acc.cal + c.calories, p: acc.p + c.protein, c: acc.c + c.carbs, f: acc.f + c.fat }),
    { cal: 0, p: 0, c: 0, f: 0 }
  );

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  function handleDelete(c: Consumption) {
    Alert.alert("Eliminar registro", `¿Eliminar consumo de ${c.product.name}?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar", style: "destructive",
        onPress: () => { deleteConsumption(c.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); },
      },
    ]);
  }

  const filterLabels: Record<Filter, string> = { today: "Hoy", week: "Semana", month: "Mes" };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.primary }]}>
        <Text style={styles.headerTitle}>Historial</Text>
        <View style={styles.filterRow}>
          {(["today", "week", "month"] as Filter[]).map((f) => (
            <Pressable
              key={f}
              style={[styles.filterChip, { backgroundColor: filter === f ? "#fff" : "rgba(255,255,255,0.2)" }]}
              onPress={() => setFilter(f)}
            >
              <Text style={[styles.filterChipText, { color: filter === f ? colors.primary : "#fff" }]}>
                {filterLabels[f]}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Totals summary */}
      {filtered.length > 0 && (
        <View style={[styles.totalsBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          {[
            { label: "Calorías", value: `${Math.round(totals.cal)}`, unit: "kcal", color: colors.calories },
            { label: "Proteína", value: `${Math.round(totals.p)}`, unit: "g", color: colors.protein },
            { label: "Carbos", value: `${Math.round(totals.c)}`, unit: "g", color: colors.carbs },
            { label: "Grasas", value: `${Math.round(totals.f)}`, unit: "g", color: colors.fat },
          ].map((m) => (
            <View key={m.label} style={styles.totalItem}>
              <Text style={[styles.totalNum, { color: m.color }]}>{m.value}<Text style={styles.totalUnit}>{m.unit}</Text></Text>
              <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>{m.label}</Text>
            </View>
          ))}
        </View>
      )}

      <FlatList
        data={grouped}
        keyExtractor={([day]) => day}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 100 },
        ]}
        scrollEnabled={grouped.length > 0}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather name="clock" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.mutedForeground }]}>Sin registros</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {filter === "today"
                ? "No hay consumos registrados hoy. Usa la Lógica Delta en el Dashboard."
                : "No hay consumos en este período."}
            </Text>
          </View>
        }
        renderItem={({ item: [day, items] }) => (
          <View style={styles.dayGroup}>
            <View style={styles.dayHeader}>
              <Text style={[styles.dayLabel, { color: colors.foreground }]}>{formatDay(day)}</Text>
              <Text style={[styles.dayTotal, { color: colors.mutedForeground }]}>
                {Math.round(items.reduce((a, c) => a + c.calories, 0))} kcal
              </Text>
            </View>
            {items.map((c) => (
              <Pressable
                key={c.id}
                style={[styles.consumptionItem, { backgroundColor: colors.card }]}
                onLongPress={() => handleDelete(c)}
              >
                <View style={styles.itemLeft}>
                  <View style={[styles.macroIndicator, { backgroundColor: colors.primary }]} />
                  <View style={styles.itemInfo}>
                    <Text style={[styles.itemName, { color: colors.foreground }]}>{c.product.name}</Text>
                    <View style={styles.itemDetailRow}>
                      <View style={[styles.deltaBadge, { backgroundColor: colors.secondary }]}>
                        <Feather name="trending-down" size={11} color={colors.primary} />
                        <Text style={[styles.deltaText, { color: colors.primary }]}>Δ {Math.abs(c.weightConsumedG).toFixed(1)}g</Text>
                      </View>
                      <Text style={[styles.itemTime, { color: colors.mutedForeground }]}>
                        {new Date(c.timestamp).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.itemRight}>
                  <Text style={[styles.itemCal, { color: colors.primary }]}>{c.calories} kcal</Text>
                  <Text style={[styles.itemMacros, { color: colors.mutedForeground }]}>
                    P:{c.protein}g C:{c.carbs}g G:{c.fat}g
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff" },
  filterRow: { flexDirection: "row", gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  filterChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  totalsBar: { flexDirection: "row", paddingVertical: 14, paddingHorizontal: 8, borderBottomWidth: 1 },
  totalItem: { flex: 1, alignItems: "center", gap: 2 },
  totalNum: { fontSize: 18, fontFamily: "Inter_700Bold" },
  totalUnit: { fontSize: 12, fontFamily: "Inter_400Regular" },
  totalLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  listContent: { padding: 16, gap: 20 },
  emptyState: { alignItems: "center", paddingTop: 64, paddingHorizontal: 32, gap: 10 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  dayGroup: { gap: 8 },
  dayHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 4 },
  dayLabel: { fontSize: 16, fontFamily: "Inter_700Bold", textTransform: "capitalize" },
  dayTotal: { fontSize: 14, fontFamily: "Inter_500Medium" },
  consumptionItem: { borderRadius: 14, padding: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  itemLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  macroIndicator: { width: 4, height: 40, borderRadius: 2 },
  itemInfo: { gap: 6 },
  itemName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  itemDetailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  deltaBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  deltaText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  itemTime: { fontSize: 12, fontFamily: "Inter_400Regular" },
  itemRight: { alignItems: "flex-end", gap: 3 },
  itemCal: { fontSize: 15, fontFamily: "Inter_700Bold" },
  itemMacros: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
