import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, login, loginAsGuest } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      router.replace("/(tabs)");
    }
  }, [user]);

  async function handleLogin() {
    if (!username.trim() || !password.trim()) {
      Alert.alert("Campos requeridos", "Ingresa usuario y contraseña");
      return;
    }
    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Error al iniciar sesión";
      Alert.alert("Error", message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGuest() {
    setSubmitting(true);
    try {
      await loginAsGuest();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Error al crear sesión de invitado";
      Alert.alert("Error", message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.logoSection}>
            <View style={[styles.logoIcon, { backgroundColor: colors.primary }]}>
              <Feather name="activity" size={32} color="#fff" />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>NutriTrack</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Balanza Nutricional Inteligente
            </Text>
          </View>

          <View style={styles.form}>
            <TextInput
              style={[styles.input, { borderColor: colors.border, backgroundColor: colors.input, color: colors.foreground }]}
              placeholder="Usuario"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={setUsername}
            />
            <TextInput
              style={[styles.input, { borderColor: colors.border, backgroundColor: colors.input, color: colors.foreground }]}
              placeholder="Contraseña"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />

            <Pressable
              style={({ pressed }) => [
                styles.loginBtn,
                { backgroundColor: colors.primary, opacity: pressed || submitting ? 0.8 : 1 },
              ]}
              onPress={handleLogin}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.loginBtnText}>Iniciar sesión</Text>
              )}
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>o</Text>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.guestBtn,
                { borderColor: colors.border, opacity: pressed || submitting ? 0.7 : 1 },
              ]}
              onPress={handleGuest}
              disabled={submitting}
            >
              <Feather name="user" size={18} color={colors.foreground} />
              <Text style={[styles.guestBtnText, { color: colors.foreground }]}>
                Entrar como invitado
              </Text>
            </Pressable>
          </View>

          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            Admin por defecto: admin / admin123
          </Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1, justifyContent: "center", padding: 24 },
  card: { borderRadius: 24, padding: 28, gap: 28, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 16, elevation: 4 },
  logoSection: { alignItems: "center", gap: 8 },
  logoIcon: { width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 28, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular" },
  form: { gap: 14 },
  input: { borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, fontFamily: "Inter_400Regular" },
  loginBtn: { paddingVertical: 16, borderRadius: 14, alignItems: "center" },
  loginBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  guestBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderRadius: 14, paddingVertical: 14 },
  guestBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
});
