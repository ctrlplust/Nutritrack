import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MacroBar } from "@/components/MacroBar";
import { useNutri } from "@/context/NutriContext";
import { useColors } from "@/hooks/useColors";

type ESP32Status = "idle" | "checking" | "online" | "offline";

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    currentProfile, todayTotals, consumptions, profiles,
    switchProfile, inventory, simulateReading, esp32ServerUrl,
  } = useNutri();

  const [profilePickerVisible, setProfilePickerVisible] = useState(false);
  const [simulateVisible, setSimulateVisible] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [newWeightInput, setNewWeightInput] = useState("");
  const [esp32Status, setEsp32Status] = useState<ESP32Status>("idle");
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const todayConsumptions = consumptions.filter((c) => {
    if (c.profileId !== currentProfile?.id) return false;
    return new Date(c.timestamp).toDateString() === new Date().toDateString();
  });

  const caloriePct =
    currentProfile && currentProfile.calorieGoal > 0
      ? Math.min(todayTotals.calories / currentProfile.calorieGoal, 1)
      : 0;

  // Pulse animation for ESP32 status dot
  useEffect(() => {
    if (esp32Status === "online") {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
    pulseAnim.setValue(1);
  }, [esp32Status]);

  async function checkServerStatus() {
    setEsp32Status("checking");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const r = await fetch(`${esp32ServerUrl}/api/nutritrack/status`, { signal: controller.signal });
      clearTimeout(timeoutId);
      setEsp32Status(r.ok ? "online" : "offline");
    } catch {
      clearTimeout(timeoutId);
      setEsp32Status("offline");
    }
  }

  function handleSimulate() {
    if (!selectedItemId || !newWeightInput) return;
    const newWeight = parseFloat(newWeightInput);
    if (isNaN(newWeight) || newWeight < 0) {
      Alert.alert("Peso inválido", "Ingresa un número válido mayor o igual a 0.");
      return;
    }
    const item = inventory.find((i) => i.id === selectedItemId);
    if (item && newWeight >= item.currentWeightG) {
      Alert.alert(
        "Sin consumo detectado",
        `El nuevo peso (${newWeight}g) debe ser menor al actual (${item.currentWeightG}g) para registrar un consumo.`
      );
      return;
    }
    simulateReading(selectedItemId, newWeight);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSimulateVisible(false);
    setNewWeightInput("");
    setSelectedItemId(null);
  }

  const selectedItem = inventory.find((i) => i.id === selectedItemId);
  const deltaPreview = selectedItem && newWeightInput
    ? selectedItem.currentWeightG - parseFloat(newWeightInput || "0")
    : null;
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const statusColor = { idle: colors.mutedForeground, checking: colors.carbs, online: "#2ECC71", offline: colors.destructive }[esp32Status];
  const statusLabel = { idle: "Sin verificar", checking: "Verificando…", online: "Servidor en línea", offline: "Sin conexión" }[esp32Status];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.primary }]}>
        <View>
          <Text style={styles.headerTitle}>NutriTrack</Text>
          <Text style={styles.headerSub}>
            {new Date().toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" })}
          </Text>
        </View>
        <Pressable
          style={[styles.profileBtn, { backgroundColor: "rgba(255,255,255,0.2)" }]}
          onPress={() => setProfilePickerVisible(true)}
        >
          <Feather name="user" size={16} color="#fff" />
          <Text style={styles.profileBtnText} numberOfLines={1}>
            {currentProfile?.name.split(" ")[0] ?? "Perfil"}
          </Text>
          <Feather name="chevron-down" size={14} color="#fff" />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Calorie Card */}
        <View style={[styles.calorieCard, { backgroundColor: colors.card }]}>
          <View style={styles.calorieRow}>
            <View style={styles.calorieLeft}>
              <Text style={[styles.calorieNum, { color: colors.primary }]}>
                {Math.round(todayTotals.calories)}
              </Text>
              <Text style={[styles.calorieUnit, { color: colors.mutedForeground }]}>kcal consumidas</Text>
            </View>
            <View style={[styles.calorieDivider, { backgroundColor: colors.border }]} />
            <View style={styles.calorieRight}>
              <Text style={[styles.calorieGoalNum, { color: colors.foreground }]}>
                {currentProfile?.calorieGoal ?? "—"}
              </Text>
              <Text style={[styles.calorieGoalLabel, { color: colors.mutedForeground }]}>meta kcal</Text>
              <View style={[styles.remainingBadge, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.remainingText, { color: colors.primary }]}>
                  {currentProfile
                    ? `${Math.max(0, currentProfile.calorieGoal - Math.round(todayTotals.calories))} restantes`
                    : "—"}
                </Text>
              </View>
            </View>
          </View>

          <View style={[styles.calorieTrack, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.calorieFill,
                {
                  width: `${caloriePct * 100}%`,
                  backgroundColor: caloriePct >= 1 ? colors.destructive : colors.primary,
                },
              ]}
            />
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.macros}>
            <MacroBar label="Proteína" current={todayTotals.protein} goal={currentProfile?.proteinGoal ?? 0} color={colors.protein} />
            <MacroBar label="Carbohidratos" current={todayTotals.carbs} goal={currentProfile?.carbsGoal ?? 0} color={colors.carbs} />
            <MacroBar label="Grasas" current={todayTotals.fat} goal={currentProfile?.fatGoal ?? 0} color={colors.fat} />
          </View>
        </View>

        {/* ESP32 Status Card */}
        <View style={[styles.esp32Card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.esp32Header}>
            <View style={styles.esp32TitleRow}>
              <Feather name="cpu" size={16} color={colors.primary} />
              <Text style={[styles.esp32Title, { color: colors.foreground }]}>ESP32 NutriTrack</Text>
            </View>
            <View style={styles.esp32StatusRow}>
              {esp32Status === "online" ? (
                <Animated.View style={[styles.statusDot, { backgroundColor: statusColor, opacity: pulseAnim }]} />
              ) : (
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              )}
              <Text style={[styles.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
            </View>
          </View>
          <View style={styles.esp32Body}>
            <View style={[styles.endpointChip, { backgroundColor: colors.background }]}>
              <Feather name="radio" size={12} color={colors.mutedForeground} />
              <Text style={[styles.endpointText, { color: colors.mutedForeground }]} numberOfLines={1}>
                POST {esp32ServerUrl}/api/nutritrack/reading
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.pingBtn,
                { backgroundColor: colors.secondary, opacity: pressed ? 0.75 : 1 },
              ]}
              onPress={checkServerStatus}
            >
              <Feather name="wifi" size={14} color={colors.primary} />
              <Text style={[styles.pingBtnText, { color: colors.primary }]}>
                {esp32Status === "checking" ? "Verificando…" : "Verificar conexión"}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Simulate Reading */}
        {inventory.length > 0 ? (
          <Pressable
            style={({ pressed }) => [
              styles.simulateBtn,
              { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={() => setSimulateVisible(true)}
          >
            <View style={[styles.simulateBtnIcon, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
              <Feather name="activity" size={18} color="#fff" />
            </View>
            <View>
              <Text style={styles.simulateBtnText}>Simular Lectura ESP32</Text>
              <Text style={styles.simulateBtnSub}>Lógica Delta · registra consumo automático</Text>
            </View>
          </Pressable>
        ) : (
          <View style={[styles.espHint, { backgroundColor: colors.card, borderColor: colors.accent }]}>
            <Feather name="info" size={16} color={colors.accent} />
            <Text style={[styles.espHintText, { color: colors.mutedForeground }]}>
              Agrega productos al inventario para registrar consumos con la Lógica Delta del ESP32
            </Text>
          </View>
        )}

        {/* Today's consumptions */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Hoy consumiste</Text>

        {todayConsumptions.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
            <Feather name="inbox" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Sin registros hoy</Text>
            <Text style={[styles.emptySubText, { color: colors.mutedForeground }]}>
              Agrega alimentos al inventario y realiza una lectura ESP32 o manual
            </Text>
          </View>
        ) : (
          todayConsumptions.slice(0, 5).map((c) => (
            <View key={c.id} style={[styles.consumptionItem, { backgroundColor: colors.card }]}>
              <View style={[styles.consumptionDot, { backgroundColor: colors.primary }]} />
              <View style={styles.consumptionInfo}>
                <Text style={[styles.consumptionName, { color: colors.foreground }]}>{c.product.name}</Text>
                <View style={styles.consumptionMetaRow}>
                  <View style={[styles.deltaBadge, { backgroundColor: colors.secondary }]}>
                    <Feather name="trending-down" size={10} color={colors.primary} />
                    <Text style={[styles.deltaText, { color: colors.primary }]}>Δ {Math.abs(c.weightConsumedG).toFixed(1)}g</Text>
                  </View>
                  <Text style={[styles.consumptionDetail, { color: colors.mutedForeground }]}>
                    {new Date(c.timestamp).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </View>
              </View>
              <View style={styles.consumptionMacros}>
                <Text style={[styles.consumptionCal, { color: colors.primary }]}>{c.calories} kcal</Text>
                <Text style={[styles.consumptionMacroDetail, { color: colors.mutedForeground }]}>
                  P:{c.protein}g C:{c.carbs}g G:{c.fat}g
                </Text>
              </View>
            </View>
          ))
        )}

        {todayConsumptions.length > 5 && (
          <Pressable onPress={() => router.push("/(tabs)/history" as any)}>
            <Text style={[styles.seeAll, { color: colors.primary }]}>
              Ver todos ({todayConsumptions.length})
            </Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Profile Picker */}
      <Modal visible={profilePickerVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setProfilePickerVisible(false)}>
          <View style={[styles.pickerCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Cambiar perfil</Text>
            {profiles.map((p) => (
              <Pressable
                key={p.id}
                style={[
                  styles.pickerItem,
                  p.id === currentProfile?.id && { backgroundColor: colors.secondary },
                ]}
                onPress={() => { switchProfile(p.id); setProfilePickerVisible(false); }}
              >
                <View style={[styles.pickerAvatar, { backgroundColor: colors.primary }]}>
                  <Text style={styles.pickerAvatarText}>{p.name[0]}</Text>
                </View>
                <Text style={[styles.pickerName, { color: colors.foreground }]}>{p.name}</Text>
                {p.id === currentProfile?.id && <Feather name="check" size={16} color={colors.primary} />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Simulate Modal */}
      <Modal visible={simulateVisible} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setSimulateVisible(false)}>
          <Pressable style={[styles.simulateCard, { backgroundColor: colors.card }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />

            <View style={styles.simulateHeaderRow}>
              <View style={[styles.simulateIconBox, { backgroundColor: colors.secondary }]}>
                <Feather name="activity" size={20} color={colors.primary} />
              </View>
              <View>
                <Text style={[styles.simulateTitle, { color: colors.foreground }]}>Simular Lectura ESP32</Text>
                <Text style={[styles.simulateSubtitle, { color: colors.mutedForeground }]}>
                  El ESP32 enviará: {"{ barcode, weightG }"}
                </Text>
              </View>
            </View>

            {/* Delta formula display */}
            <View style={[styles.formulaBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[styles.formulaTitle, { color: colors.mutedForeground }]}>Lógica Delta aplicada:</Text>
              <Text style={[styles.formulaText, { color: colors.primary }]}>
                Δ consumo = Peso anterior − Peso nuevo
              </Text>
              {selectedItem && newWeightInput && deltaPreview !== null && (
                <Text style={[
                  styles.formulaResult,
                  { color: deltaPreview > 0 ? colors.protein : colors.mutedForeground }
                ]}>
                  = {selectedItem.currentWeightG}g − {newWeightInput}g = <Text style={{ fontFamily: "Inter_700Bold" }}>{deltaPreview}g consumidos</Text>
                </Text>
              )}
            </View>

            <Text style={[styles.simulateLabel, { color: colors.mutedForeground }]}>Producto en balanza:</Text>
            <ScrollView style={{ maxHeight: 160 }}>
              {inventory.map((item) => (
                <Pressable
                  key={item.id}
                  style={[
                    styles.inventoryOption,
                    {
                      borderColor: selectedItemId === item.id ? colors.primary : colors.border,
                      backgroundColor: selectedItemId === item.id ? colors.secondary : colors.background,
                    },
                  ]}
                  onPress={() => { setSelectedItemId(item.id); setNewWeightInput(""); }}
                >
                  <View>
                    <Text style={[styles.inventoryOptionName, { color: colors.foreground }]}>{item.product.name}</Text>
                    <Text style={[styles.inventoryOptionBarcode, { color: colors.mutedForeground }]}>
                      {item.product.barcode}
                    </Text>
                  </View>
                  <Text style={[styles.inventoryOptionWeight, { color: colors.primary }]}>
                    {item.currentWeightG}g actual
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {selectedItem && (
              <>
                <Text style={[styles.simulateLabel, { color: colors.mutedForeground }]}>
                  Nuevo peso detectado por sensor (g):
                </Text>
                <TextInput
                  style={[
                    styles.weightInput,
                    { borderColor: colors.border, backgroundColor: colors.input, color: colors.foreground },
                  ]}
                  placeholder={`Menor a ${selectedItem.currentWeightG}g`}
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="numeric"
                  value={newWeightInput}
                  onChangeText={setNewWeightInput}
                />
              </>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.simulateConfirmBtn,
                {
                  backgroundColor:
                    selectedItemId && newWeightInput && (deltaPreview ?? 0) > 0
                      ? colors.primary
                      : colors.muted,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              onPress={handleSimulate}
            >
              <Feather
                name="check-circle"
                size={16}
                color={selectedItemId && newWeightInput && (deltaPreview ?? 0) > 0 ? "#fff" : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.simulateConfirmText,
                  {
                    color: selectedItemId && newWeightInput && (deltaPreview ?? 0) > 0
                      ? "#fff"
                      : colors.mutedForeground,
                  },
                ]}
              >
                Registrar Consumo (Δ Delta)
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)", marginTop: 2, textTransform: "capitalize" },
  profileBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, gap: 6, maxWidth: 140 },
  profileBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 14 },
  calorieCard: { borderRadius: 16, padding: 20, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3, gap: 16 },
  calorieRow: { flexDirection: "row", alignItems: "center" },
  calorieLeft: { flex: 1, alignItems: "center" },
  calorieNum: { fontSize: 40, fontFamily: "Inter_700Bold", lineHeight: 44 },
  calorieUnit: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  calorieDivider: { width: 1, height: 56, marginHorizontal: 16 },
  calorieRight: { flex: 1, alignItems: "center", gap: 6 },
  calorieGoalNum: { fontSize: 24, fontFamily: "Inter_700Bold" },
  calorieGoalLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  remainingBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  remainingText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  calorieTrack: { height: 10, borderRadius: 5, overflow: "hidden" },
  calorieFill: { height: 10, borderRadius: 5 },
  divider: { height: 1 },
  macros: { gap: 12 },
  // ESP32 Card
  esp32Card: { borderRadius: 14, padding: 14, borderWidth: 1, gap: 10 },
  esp32Header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  esp32TitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  esp32Title: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  esp32StatusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  esp32Body: { flexDirection: "row", gap: 8, alignItems: "center" },
  endpointChip: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  endpointText: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1 },
  pingBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  pingBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  // Simulate btn
  simulateBtn: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 16, paddingHorizontal: 18, borderRadius: 14 },
  simulateBtnIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  simulateBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  simulateBtnSub: { color: "rgba(255,255,255,0.8)", fontSize: 11, fontFamily: "Inter_400Regular" },
  espHint: { borderRadius: 12, padding: 14, flexDirection: "row", gap: 10, borderWidth: 1.5 },
  espHintText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  emptyCard: { borderRadius: 16, padding: 32, alignItems: "center", gap: 8 },
  emptyText: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginTop: 8 },
  emptySubText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  consumptionItem: { borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  consumptionDot: { width: 4, height: 40, borderRadius: 2 },
  consumptionInfo: { flex: 1, gap: 6 },
  consumptionName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  consumptionMetaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  deltaBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  deltaText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  consumptionDetail: { fontSize: 12, fontFamily: "Inter_400Regular" },
  consumptionMacros: { alignItems: "flex-end", gap: 2 },
  consumptionCal: { fontSize: 14, fontFamily: "Inter_700Bold" },
  consumptionMacroDetail: { fontSize: 11, fontFamily: "Inter_400Regular" },
  seeAll: { textAlign: "center", fontSize: 14, fontFamily: "Inter_600SemiBold", paddingVertical: 8 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end", alignItems: "center" },
  pickerCard: { width: "90%", borderRadius: 20, padding: 20, gap: 8, marginBottom: 40 },
  pickerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 8 },
  pickerItem: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12 },
  pickerAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  pickerAvatarText: { color: "#fff", fontSize: 16, fontFamily: "Inter_700Bold" },
  pickerName: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  simulateCard: { width: "100%", borderRadius: 24, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, padding: 24, paddingTop: 12, gap: 12 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  simulateHeaderRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  simulateIconBox: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  simulateTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  simulateSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular" },
  formulaBox: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  formulaTitle: { fontSize: 11, fontFamily: "Inter_500Medium" },
  formulaText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  formulaResult: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 2 },
  simulateLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inventoryOption: { borderWidth: 1.5, borderRadius: 12, padding: 12, marginBottom: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  inventoryOptionName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  inventoryOptionBarcode: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  inventoryOptionWeight: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  weightInput: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, fontFamily: "Inter_400Regular" },
  simulateConfirmBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 14, marginTop: 4 },
  simulateConfirmText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
