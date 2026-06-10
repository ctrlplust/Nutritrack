import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
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
import { type ActivityLevel, type Profile, type Sex, calcTDEE, useNutri } from "@/context/NutriContext";
import { useColors } from "@/hooks/useColors";

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Sedentario (sin ejercicio)",
  light: "Ligero (1-3 días/sem)",
  moderate: "Moderado (3-5 días/sem)",
  active: "Activo (6-7 días/sem)",
  veryActive: "Muy activo (2 veces/día)",
};

type ProfileFormData = {
  name: string;
  heightCm: string;
  weightKg: string;
  age: string;
  sex: Sex | "";
  activityLevel: ActivityLevel | "";
  calorieGoal: string;
  proteinGoal: string;
  carbsGoal: string;
  fatGoal: string;
};

function emptyForm(): ProfileFormData {
  return {
    name: "", heightCm: "", weightKg: "", age: "",
    sex: "", activityLevel: "",
    calorieGoal: "2000", proteinGoal: "150", carbsGoal: "250", fatGoal: "65",
  };
}

function profileToForm(p: Profile): ProfileFormData {
  return {
    name: p.name,
    heightCm: p.heightCm ? String(p.heightCm) : "",
    weightKg: p.weightKg ? String(p.weightKg) : "",
    age: p.age ? String(p.age) : "",
    sex: p.sex ?? "",
    activityLevel: p.activityLevel ?? "",
    calorieGoal: String(p.calorieGoal),
    proteinGoal: String(p.proteinGoal),
    carbsGoal: String(p.carbsGoal),
    fatGoal: String(p.fatGoal),
  };
}

function formToProfile(form: ProfileFormData): Omit<Profile, "id"> {
  const base: Omit<Profile, "id"> = {
    name: form.name.trim(),
    calorieGoal: parseInt(form.calorieGoal) || 2000,
    proteinGoal: parseInt(form.proteinGoal) || 150,
    carbsGoal: parseInt(form.carbsGoal) || 250,
    fatGoal: parseInt(form.fatGoal) || 65,
  };
  if (form.heightCm) base.heightCm = parseFloat(form.heightCm);
  if (form.weightKg) base.weightKg = parseFloat(form.weightKg);
  if (form.age) base.age = parseInt(form.age);
  if (form.sex) base.sex = form.sex;
  if (form.activityLevel) base.activityLevel = form.activityLevel;
  return base;
}

function StatusIndicator() {
  const { esp32ServerUrl } = useNutri();
  const [serverStatus, setServerStatus] = useState<"loading" | "online" | "offline">("loading");

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch(`${esp32ServerUrl}/api/nutritrack/status`, { signal: AbortSignal.timeout(2000) });
        setServerStatus(res.ok ? "online" : "offline");
      } catch (e) {
        setServerStatus("offline");
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 10000);
    return () => clearInterval(interval);
  }, [esp32ServerUrl]);

  const color = serverStatus === "online" ? "#27AE60" : serverStatus === "offline" ? "#E74C3C" : "#F39C12";
  const label = serverStatus === "online" ? "Online" : serverStatus === "offline" ? "Offline" : "Verificando...";

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ fontSize: 12, color }}>{label}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { profiles, currentProfile, switchProfile, addProfile, updateProfile, consumptions, todayTotals } = useNutri();
  const [addModal, setAddModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Profile | null>(null);
  const [form, setForm] = useState<ProfileFormData>(emptyForm());
  const [endpointExpanded, setEndpointExpanded] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  function openAdd() { setForm(emptyForm()); setAddModal(true); }
  function openEdit(p: Profile) { setEditTarget(p); setForm(profileToForm(p)); setEditModal(true); }

  function handleAdd() {
    if (!form.name.trim()) { Alert.alert("Falta el nombre", "Ingresa un nombre para el perfil."); return; }
    addProfile(formToProfile(form));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAddModal(false);
  }

  function handleSaveEdit() {
    if (!editTarget || !form.name.trim()) return;
    updateProfile({ ...formToProfile(form), id: editTarget.id });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEditModal(false);
  }

  const totalConsumed = consumptions.filter((c) => c.profileId === currentProfile?.id).length;
  const totalCaloriesAll = consumptions
    .filter((c) => c.profileId === currentProfile?.id)
    .reduce((a, c) => a + c.calories, 0);

  const tdee = currentProfile ? calcTDEE(currentProfile) : null;

  const bmi = currentProfile?.heightCm && currentProfile?.weightKg
    ? Math.round((currentProfile.weightKg / Math.pow(currentProfile.heightCm / 100, 2)) * 10) / 10
    : null;

  const bmiLabel = bmi
    ? bmi < 18.5 ? "Bajo peso" : bmi < 25 ? "Normal" : bmi < 30 ? "Sobrepeso" : "Obesidad"
    : null;
  const bmiColor = bmi
    ? bmi < 18.5 ? "#3498DB" : bmi < 25 ? "#27AE60" : bmi < 30 ? "#E67E22" : "#E74C3C"
    : null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.primary }]}>
        <Text style={styles.headerTitle}>Perfil</Text>
        <Pressable style={[styles.addBtn, { backgroundColor: "rgba(255,255,255,0.2)" }]} onPress={openAdd}>
          <Feather name="user-plus" size={18} color="#fff" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Current Profile Card */}
        {currentProfile && (
          <View style={[styles.currentCard, { backgroundColor: colors.primary }]}>
            <View style={styles.currentAvatarRow}>
              <View style={[styles.avatar, { backgroundColor: "rgba(255,255,255,0.25)" }]}>
                <Text style={styles.avatarText}>{currentProfile.name[0]}</Text>
              </View>
              <View style={styles.currentInfo}>
                <Text style={styles.currentName}>{currentProfile.name}</Text>
                <Text style={styles.currentSub}>
                  {currentProfile.heightCm && currentProfile.weightKg
                    ? `${currentProfile.heightCm}cm · ${currentProfile.weightKg}kg · ${currentProfile.age ?? "—"} años`
                    : "Perfil activo · NutriTrack"}
                </Text>
              </View>
              <Pressable onPress={() => openEdit(currentProfile)}>
                <Feather name="edit-2" size={18} color="rgba(255,255,255,0.8)" />
              </Pressable>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statNum}>{Math.round(todayTotals.calories)}</Text>
                <Text style={styles.statLabel}>kcal hoy</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNum}>{totalConsumed}</Text>
                <Text style={styles.statLabel}>registros</Text>
              </View>
              <View style={styles.statDivider} />
              {bmi ? (
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: bmiColor ?? "#fff" }]}>{bmi}</Text>
                  <Text style={styles.statLabel}>IMC ({bmiLabel})</Text>
                </View>
              ) : (
                <View style={styles.statItem}>
                  <Text style={styles.statNum}>{Math.round(totalCaloriesAll / 1000 * 10) / 10}k</Text>
                  <Text style={styles.statLabel}>kcal totales</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* TDEE Card */}
        {tdee && (
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Feather name="zap" size={16} color={colors.primary} />
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Tu gasto energético</Text>
              </View>
              <View style={[styles.autoBadge, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.autoBadgeText, { color: colors.primary }]}>Auto</Text>
              </View>
            </View>
            <View style={styles.tdeeRow}>
              <View style={styles.tdeeItem}>
                <Text style={[styles.tdeeNum, { color: colors.mutedForeground }]}>{tdee.bmr}</Text>
                <Text style={[styles.tdeeLabel, { color: colors.mutedForeground }]}>BMR (basal)</Text>
              </View>
              <Feather name="arrow-right" size={16} color={colors.mutedForeground} />
              <View style={styles.tdeeItem}>
                <Text style={[styles.tdeeNum, { color: colors.primary }]}>{tdee.tdee}</Text>
                <Text style={[styles.tdeeLabel, { color: colors.mutedForeground }]}>TDEE (total)</Text>
              </View>
              <Text style={[styles.tdeeUnit, { color: colors.mutedForeground }]}>kcal/día</Text>
            </View>
            <Text style={[styles.tdeeNote, { color: colors.mutedForeground }]}>
              Fórmula Mifflin-St Jeor · Actividad: {ACTIVITY_LABELS[currentProfile?.activityLevel ?? "moderate"]}
            </Text>
          </View>
        )}

        {/* Metas */}
        {currentProfile && (
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Metas diarias</Text>
              <Pressable onPress={() => openEdit(currentProfile)}>
                <Text style={[styles.editLink, { color: colors.primary }]}>Editar</Text>
              </Pressable>
            </View>
            {[
              { label: "Calorías", value: currentProfile.calorieGoal, unit: "kcal", color: colors.calories },
              { label: "Proteínas", value: currentProfile.proteinGoal, unit: "g", color: colors.protein },
              { label: "Carbohidratos", value: currentProfile.carbsGoal, unit: "g", color: colors.carbs },
              { label: "Grasas", value: currentProfile.fatGoal, unit: "g", color: colors.fat },
            ].map((g, idx, arr) => (
              <View key={g.label} style={[styles.goalRow, { borderBottomColor: colors.border, borderBottomWidth: idx < arr.length - 1 ? 1 : 0 }]}>
                <View style={[styles.goalDot, { backgroundColor: g.color }]} />
                <Text style={[styles.goalLabel, { color: colors.foreground }]}>{g.label}</Text>
                <Text style={[styles.goalValue, { color: g.color }]}>
                  {g.value}<Text style={[styles.goalUnit, { color: colors.mutedForeground }]}>{g.unit}</Text>
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Other Profiles */}
        {profiles.filter((p) => p.id !== currentProfile?.id).length > 0 && (
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Otros perfiles</Text>
            {profiles.filter((p) => p.id !== currentProfile?.id).map((p, idx, arr) => (
              <Pressable
                key={p.id}
                style={[styles.profileRow, { borderBottomColor: colors.border, borderBottomWidth: idx < arr.length - 1 ? 1 : 0 }]}
                onPress={() => { switchProfile(p.id); Haptics.selectionAsync(); }}
              >
                <View style={[styles.profileAvatar, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.profileAvatarText, { color: colors.primary }]}>{p.name[0]}</Text>
                </View>
                <View style={styles.profileInfo}>
                  <Text style={[styles.profileName, { color: colors.foreground }]}>{p.name}</Text>
                  <Text style={[styles.profileGoal, { color: colors.mutedForeground }]}>Meta: {p.calorieGoal} kcal/día</Text>
                </View>
                <View style={styles.profileRowRight}>
                  <Pressable onPress={() => openEdit(p)} style={styles.editBtn}>
                    <Feather name="edit-2" size={15} color={colors.mutedForeground} />
                  </Pressable>
                  <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {/* ESP32 API Integration */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <Pressable style={styles.sectionHeader} onPress={() => setEndpointExpanded(!endpointExpanded)}>
            <View style={styles.sectionTitleRow}>
              <Feather name="cpu" size={16} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Integración ESP32</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <StatusIndicator />
              <Feather name={endpointExpanded ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
            </View>
          </Pressable>
          {endpointExpanded && (
            <View style={styles.endpointContent}>
              <Text style={[styles.endpointDescription, { color: colors.mutedForeground }]}>
                El ESP32 escanea el código de barras con su lector integrado y envía el peso al servidor. La app muestra los resultados en tiempo real.
              </Text>
              {[
                { method: "GET", path: "/api/nutritrack/status", desc: "Verificar conectividad del servidor" },
                { method: "POST", path: "/api/nutritrack/reading", desc: "Enviar lectura de peso (Lógica Delta)" },
                { method: "POST", path: "/api/nutritrack/inventory", desc: "Registrar peso inicial de producto" },
                { method: "GET", path: "/api/nutritrack/products", desc: "Consultar base de datos de productos" },
              ].map((ep) => (
                <View key={ep.path} style={[styles.endpointRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
                  <View style={[styles.methodBadge, { backgroundColor: ep.method === "GET" ? colors.secondary : "#FFF3E0" }]}>
                    <Text style={[styles.methodText, { color: ep.method === "GET" ? colors.primary : "#E67E22" }]}>{ep.method}</Text>
                  </View>
                  <View style={styles.endpointInfo}>
                    <Text style={[styles.endpointPath, { color: colors.foreground }]}>{ep.path}</Text>
                    <Text style={[styles.endpointDesc, { color: colors.mutedForeground }]}>{ep.desc}</Text>
                  </View>
                </View>
              ))}
              <View style={[styles.codeBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={[styles.codeText, { color: colors.foreground }]}>{`{\n  "barcode": "7802800053001",\n  "weightG": 245,\n  "deviceId": "esp32-001"\n}`}</Text>
              </View>
              <View style={[styles.toleranceBox, { backgroundColor: colors.secondary }]}>
                <Feather name="shield" size={13} color={colors.primary} />
                <Text style={[styles.toleranceText, { color: colors.primary }]}>Tolerancia anti-ruido: ±5g. Cambios menores no se registran.</Text>
              </View>
            </View>
          )}
        </View>

        {/* Sistema IoT */}
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Sistema IoT</Text>
          <View style={styles.aboutContent}>
            {[
              { icon: "cpu", title: "Microcontrolador", desc: "ESP32 — Wi-Fi 802.11 b/g/n + BT 4.2" },
              { icon: "activity", title: "Sensor de peso", desc: "Celda de carga + módulo HX711 (ADC 24-bit)" },
              { icon: "bar-chart-2", title: "Lector de código de barras", desc: "Escáner integrado al ESP32 para identificar productos" },
              { icon: "bar-chart", title: "Lógica Delta (Δ)", desc: "Δ = Peso anterior − Peso nuevo. Tolerancia ±5g" },
              { icon: "wifi", title: "Transmisión", desc: "HTTP POST vía Wi-Fi al servidor en < 3 segundos" },
              { icon: "lock", title: "Seguridad", desc: "TLS 1.2+ en tránsito. Datos cifrados en reposo" },
            ].map((item) => (
              <View key={item.icon} style={styles.aboutRow}>
                <View style={[styles.aboutIconBox, { backgroundColor: colors.secondary }]}>
                  <Feather name={item.icon as any} size={16} color={colors.primary} />
                </View>
                <View style={styles.aboutText}>
                  <Text style={[styles.aboutTitle, { color: colors.foreground }]}>{item.title}</Text>
                  <Text style={[styles.aboutDesc, { color: colors.mutedForeground }]}>{item.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Project info */}
        <View style={[styles.projectCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.projectTitle, { color: colors.primary }]}>NutriTrack v1.0</Text>
          <Text style={[styles.projectSub, { color: colors.mutedForeground }]}>
            Proyectos TIC I · UDP · 2026{"\n"}
            Automatización del Registro Nutricional mediante Lógica Delta y ESP32
          </Text>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Text style={[styles.teamTitle, { color: colors.mutedForeground }]}>Equipo de desarrollo:</Text>
          {[
            { name: "Tomás Núñez", role: "Jefe de Proyecto · Arquitecto de Software" },
            { name: "Benjamín Bustamante", role: "Administrador · Documentación" },
            { name: "Benjamín Zúñiga", role: "Validación · Comunicación Estratégica" },
            { name: "Benjamín Arredondo", role: "Hardware · Firmware ESP32" },
          ].map((m) => (
            <View key={m.name} style={styles.memberRow}>
              <View style={[styles.memberDot, { backgroundColor: colors.primary }]} />
              <View>
                <Text style={[styles.memberName, { color: colors.foreground }]}>{m.name}</Text>
                <Text style={[styles.memberRole, { color: colors.mutedForeground }]}>{m.role}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Add Profile Modal */}
      <Modal visible={addModal} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setAddModal(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
            <Pressable style={[styles.modalCard, { backgroundColor: colors.card }]} onPress={() => {}}>
              <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Nuevo perfil</Text>
              <ProfileForm form={form} setForm={setForm} colors={colors} />
              <Pressable style={[styles.confirmBtn, { backgroundColor: colors.primary }]} onPress={handleAdd}>
                <Text style={[styles.confirmBtnText, { color: "#fff" }]}>Crear perfil</Text>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Edit Profile Modal */}
      <Modal visible={editModal} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setEditModal(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
            <Pressable style={[styles.modalCard, { backgroundColor: colors.card }]} onPress={() => {}}>
              <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Editar perfil</Text>
              <ProfileForm form={form} setForm={setForm} colors={colors} />
              <Pressable style={[styles.confirmBtn, { backgroundColor: colors.primary }]} onPress={handleSaveEdit}>
                <Text style={[styles.confirmBtnText, { color: "#fff" }]}>Guardar cambios</Text>
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </View>
  );
}

function ProfileForm({ form, setForm, colors }: {
  form: ProfileFormData;
  setForm: (f: ProfileFormData) => void;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const computed = calcTDEE({
    heightCm: form.heightCm ? parseFloat(form.heightCm) : undefined,
    weightKg: form.weightKg ? parseFloat(form.weightKg) : undefined,
    age: form.age ? parseInt(form.age) : undefined,
    sex: form.sex || undefined,
    activityLevel: form.activityLevel || undefined,
  });

  function applyTDEE() {
    if (!computed) return;
    setForm({
      ...form,
      calorieGoal: String(computed.calories),
      proteinGoal: String(computed.proteinGoal),
      carbsGoal: String(computed.carbsGoal),
      fatGoal: String(computed.fatGoal),
    });
  }

  return (
    <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        {/* Nombre */}
        <View style={pfStyles.field}>
          <Text style={[pfStyles.label, { color: colors.mutedForeground }]}>Nombre *</Text>
          <TextInput
            style={[pfStyles.input, { borderColor: colors.border, backgroundColor: colors.input, color: colors.foreground }]}
            value={form.name} onChangeText={(t) => setForm({ ...form, name: t })}
            placeholder="ej. Tomás Núñez" placeholderTextColor={colors.mutedForeground}
          />
        </View>

        {/* Datos físicos */}
        <Text style={[pfStyles.section, { color: colors.primary }]}>Datos físicos</Text>
        <View style={pfStyles.row}>
          <View style={pfStyles.cell}>
            <Text style={[pfStyles.label, { color: colors.mutedForeground }]}>Altura (cm)</Text>
            <TextInput
              style={[pfStyles.input, { borderColor: colors.border, backgroundColor: colors.input, color: colors.foreground }]}
              value={form.heightCm} onChangeText={(t) => setForm({ ...form, heightCm: t })}
              keyboardType="numeric" placeholder="175" placeholderTextColor={colors.mutedForeground}
            />
          </View>
          <View style={pfStyles.cell}>
            <Text style={[pfStyles.label, { color: colors.mutedForeground }]}>Peso (kg)</Text>
            <TextInput
              style={[pfStyles.input, { borderColor: colors.border, backgroundColor: colors.input, color: colors.foreground }]}
              value={form.weightKg} onChangeText={(t) => setForm({ ...form, weightKg: t })}
              keyboardType="numeric" placeholder="70" placeholderTextColor={colors.mutedForeground}
            />
          </View>
        </View>

        <View style={pfStyles.row}>
          <View style={pfStyles.cell}>
            <Text style={[pfStyles.label, { color: colors.mutedForeground }]}>Edad</Text>
            <TextInput
              style={[pfStyles.input, { borderColor: colors.border, backgroundColor: colors.input, color: colors.foreground }]}
              value={form.age} onChangeText={(t) => setForm({ ...form, age: t })}
              keyboardType="numeric" placeholder="25" placeholderTextColor={colors.mutedForeground}
            />
          </View>
          <View style={pfStyles.cell}>
            <Text style={[pfStyles.label, { color: colors.mutedForeground }]}>Sexo</Text>
            <View style={pfStyles.segmented}>
              {(["male", "female"] as Sex[]).map((s) => (
                <Pressable
                  key={s}
                  style={[pfStyles.segment, { backgroundColor: form.sex === s ? colors.primary : colors.input, borderColor: colors.border }]}
                  onPress={() => setForm({ ...form, sex: s })}
                >
                  <Text style={[pfStyles.segmentText, { color: form.sex === s ? "#fff" : colors.mutedForeground }]}>
                    {s === "male" ? "Hombre" : "Mujer"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        {/* Actividad */}
        <View style={pfStyles.field}>
          <Text style={[pfStyles.label, { color: colors.mutedForeground }]}>Nivel de actividad</Text>
          <View style={{ gap: 6 }}>
            {(["sedentary", "light", "moderate", "active", "veryActive"] as ActivityLevel[]).map((a) => (
              <Pressable
                key={a}
                style={[pfStyles.activityRow, {
                  borderColor: form.activityLevel === a ? colors.primary : colors.border,
                  backgroundColor: form.activityLevel === a ? colors.secondary : colors.input,
                }]}
                onPress={() => setForm({ ...form, activityLevel: a })}
              >
                <View style={[pfStyles.activityDot, { backgroundColor: form.activityLevel === a ? colors.primary : colors.border }]} />
                <Text style={[pfStyles.activityText, { color: form.activityLevel === a ? colors.primary : colors.foreground }]}>
                  {ACTIVITY_LABELS[a]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Calcular automáticamente */}
        {computed && (
          <Pressable
            style={[pfStyles.calcBtn, { backgroundColor: "#E8F5E9", borderColor: colors.primary }]}
            onPress={applyTDEE}
          >
            <Feather name="zap" size={15} color={colors.primary} />
            <Text style={[pfStyles.calcBtnText, { color: colors.primary }]}>
              Calcular metas ({computed.calories} kcal, P:{computed.proteinGoal}g C:{computed.carbsGoal}g G:{computed.fatGoal}g)
            </Text>
          </Pressable>
        )}

        {/* Metas manuales */}
        <Text style={[pfStyles.section, { color: colors.mutedForeground }]}>Metas diarias</Text>
        <View style={pfStyles.row}>
          {[
            { key: "calorieGoal" as const, label: "Calorías (kcal)", color: colors.calories },
            { key: "proteinGoal" as const, label: "Proteínas (g)", color: colors.protein },
          ].map((f) => (
            <View key={f.key} style={pfStyles.cell}>
              <Text style={[pfStyles.label, { color: f.color }]}>{f.label}</Text>
              <TextInput
                style={[pfStyles.input, { borderColor: colors.border, backgroundColor: colors.input, color: colors.foreground }]}
                value={form[f.key]} onChangeText={(t) => setForm({ ...form, [f.key]: t })}
                keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedForeground}
              />
            </View>
          ))}
        </View>
        <View style={pfStyles.row}>
          {[
            { key: "carbsGoal" as const, label: "Carbohidratos (g)", color: colors.carbs },
            { key: "fatGoal" as const, label: "Grasas (g)", color: colors.fat },
          ].map((f) => (
            <View key={f.key} style={pfStyles.cell}>
              <Text style={[pfStyles.label, { color: f.color }]}>{f.label}</Text>
              <TextInput
                style={[pfStyles.input, { borderColor: colors.border, backgroundColor: colors.input, color: colors.foreground }]}
                value={form[f.key]} onChangeText={(t) => setForm({ ...form, [f.key]: t })}
                keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedForeground}
              />
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const pfStyles = StyleSheet.create({
  field: { gap: 4 },
  label: { fontSize: 12, fontFamily: "Inter_500Medium" },
  input: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: "Inter_400Regular" },
  section: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  row: { flexDirection: "row", gap: 12 },
  cell: { flex: 1, gap: 4 },
  segmented: { flexDirection: "row", gap: 6 },
  segment: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, alignItems: "center" },
  segmentText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  activityRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  activityDot: { width: 8, height: 8, borderRadius: 4 },
  activityText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  calcBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  calcBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff" },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, gap: 14 },
  currentCard: { borderRadius: 20, padding: 20, gap: 20 },
  currentAvatarRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 22, fontFamily: "Inter_700Bold" },
  currentInfo: { flex: 1 },
  currentName: { color: "#fff", fontSize: 20, fontFamily: "Inter_700Bold" },
  currentSub: { color: "rgba(255,255,255,0.75)", fontSize: 13, fontFamily: "Inter_400Regular" },
  statsRow: { flexDirection: "row", alignItems: "center" },
  statItem: { flex: 1, alignItems: "center", gap: 2 },
  statNum: { color: "#fff", fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { color: "rgba(255,255,255,0.75)", fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center" },
  statDivider: { width: 1, height: 36, backgroundColor: "rgba(255,255,255,0.25)" },
  section: { borderRadius: 16, padding: 18, gap: 14, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  editLink: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  autoBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  autoBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  tdeeRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  tdeeItem: { alignItems: "center", gap: 2 },
  tdeeNum: { fontSize: 22, fontFamily: "Inter_700Bold" },
  tdeeLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  tdeeUnit: { fontSize: 12, fontFamily: "Inter_400Regular", marginLeft: "auto" },
  tdeeNote: { fontSize: 12, fontFamily: "Inter_400Regular", fontStyle: "italic" },
  goalRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  goalDot: { width: 8, height: 8, borderRadius: 4 },
  goalLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  goalValue: { fontSize: 17, fontFamily: "Inter_700Bold" },
  goalUnit: { fontSize: 13, fontFamily: "Inter_400Regular" },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  profileAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  profileAvatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  profileInfo: { flex: 1, gap: 2 },
  profileName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  profileGoal: { fontSize: 13, fontFamily: "Inter_400Regular" },
  profileRowRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  editBtn: { padding: 6 },
  endpointContent: { gap: 10 },
  endpointDescription: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  endpointRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderRadius: 10, padding: 10 },
  methodBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  methodText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  endpointInfo: { flex: 1, gap: 2 },
  endpointPath: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  endpointDesc: { fontSize: 12, fontFamily: "Inter_400Regular" },
  codeBox: { borderWidth: 1, borderRadius: 10, padding: 12 },
  codeText: { fontSize: 12, fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },
  toleranceBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 8, padding: 10 },
  toleranceText: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  aboutContent: { gap: 12 },
  aboutRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  aboutIconBox: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  aboutText: { flex: 1 },
  aboutTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  aboutDesc: { fontSize: 13, fontFamily: "Inter_400Regular" },
  divider: { height: 1, marginVertical: 4 },
  projectCard: { borderRadius: 16, padding: 18, gap: 12, borderWidth: 1 },
  projectTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  projectSub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  teamTitle: { fontSize: 12, fontFamily: "Inter_500Medium" },
  memberRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  memberDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  memberName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  memberRole: { fontSize: 12, fontFamily: "Inter_400Regular" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalCard: { borderRadius: 24, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, padding: 24, paddingTop: 12, gap: 14 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  confirmBtn: { paddingVertical: 16, borderRadius: 14, alignItems: "center", marginTop: 4 },
  confirmBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
