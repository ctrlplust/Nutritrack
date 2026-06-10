import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface Props {
  onScan: (barcode: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ onScan, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const scanLine = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(scanLine, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    ).start();
  }, [scanLine]);

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#27AE60" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 20 }]}>
        <Feather name="camera-off" size={48} color="#888" />
        <Text style={styles.permText}>NutriTrack necesita acceso a la cámara para escanear códigos de barras.</Text>
        <Pressable style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Dar permiso de cámara</Text>
        </Pressable>
        <Pressable style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>Cancelar</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "qr"] }}
        onBarcodeScanned={scanned ? undefined : ({ data }) => {
          if (!data) return;
          setScanned(true);
          setTimeout(() => onScan(data), 100);
        }}
      />

      {/* Dark overlay with cutout */}
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.overlayTop} />
        <View style={styles.overlayMid}>
          <View style={styles.overlaySide} />
          <View style={styles.cutout}>
            {/* Corner marks */}
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
            {/* Scan line */}
            <Animated.View
              style={[
                styles.scanLine,
                {
                  transform: [{
                    translateY: scanLine.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, 220],
                    }),
                  }],
                },
              ]}
            />
          </View>
          <View style={styles.overlaySide} />
        </View>
        <View style={styles.overlayBottom}>
          <Text style={styles.hint}>Apunta al código de barras del producto</Text>
        </View>
      </View>

      {/* Close button */}
      <Pressable
        style={[styles.closeFab, { top: insets.top + 16 }]}
        onPress={onClose}
        hitSlop={12}
      >
        <Feather name="x" size={22} color="#fff" />
      </Pressable>

      {scanned && (
        <View style={styles.scannedOverlay}>
          <Feather name="check-circle" size={48} color="#27AE60" />
          <Text style={styles.scannedText}>¡Código detectado!</Text>
        </View>
      )}
    </View>
  );
}

const CUTOUT = 260;

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000", padding: 32, gap: 16 },
  permText: { color: "#fff", textAlign: "center", fontSize: 15, lineHeight: 22 },
  permBtn: { backgroundColor: "#27AE60", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  permBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  closeBtn: { marginTop: 8 },
  closeBtnText: { color: "#aaa", fontSize: 14 },

  overlay: { ...StyleSheet.absoluteFillObject },
  overlayTop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  overlayMid: { flexDirection: "row", height: CUTOUT },
  overlaySide: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  overlayBottom: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", paddingTop: 20 },
  cutout: { width: CUTOUT, height: CUTOUT, overflow: "hidden" },

  corner: { position: "absolute", width: 24, height: 24, borderColor: "#27AE60", borderWidth: 3 },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },

  scanLine: { position: "absolute", left: 0, right: 0, height: 2, backgroundColor: "#27AE60", shadowColor: "#27AE60", shadowOpacity: 0.8, shadowRadius: 4 },
  hint: { color: "rgba(255,255,255,0.85)", fontSize: 14, textAlign: "center", paddingHorizontal: 32 },

  closeFab: {
    position: "absolute", left: 16,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 24, padding: 10,
  },

  scannedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center", justifyContent: "center", gap: 12,
  },
  scannedText: { color: "#fff", fontSize: 18, fontWeight: "600" },
});
