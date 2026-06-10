import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BarcodeScanner from "@/components/BarcodeScanner";
import ALIMENTOS, { type AlimentoINTA, buscarAlimento } from "@/data/alimentos_inta";
import { useNutri, type Product } from "@/context/NutriContext";
import { useColors } from "@/hooks/useColors";

type Tab = "despensa" | "buscar";

// ─── Barcode lookup ──────────────────────────────────────────────────────────
interface ScannedProduct {
  barcode?: string;
  name: string;
  brand?: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
}

async function lookupBarcode(
  barcode: string,
  localProducts: Product[]
): Promise<ScannedProduct | null> {
  const local = localProducts.find((p) => p.barcode === barcode);
  if (local) return local as ScannedProduct;
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    const p = data.product;
    const n = p.nutriments ?? {};
    const name =
      p.product_name_es || p.product_name || p.product_name_en || "";
    if (!name) return null;
    return {
      barcode,
      name: name.trim(),
      brand: p.brands?.split(",")[0]?.trim(),
      caloriesPer100g: Math.round(
        n["energy-kcal_100g"] ?? n["energy-kcal"] ?? 0
      ),
      proteinPer100g: Math.round((n.proteins_100g ?? 0) * 10) / 10,
      carbsPer100g: Math.round((n.carbohydrates_100g ?? 0) * 10) / 10,
      fatPer100g: Math.round((n.fat_100g ?? 0) * 10) / 10,
    };
  } catch {
    return null;
  }
}

function alimentoToScanned(a: AlimentoINTA): ScannedProduct {
  return {
    name: a.nombre,
    brand: a.marca,
    caloriesPer100g: a.calorias,
    proteinPer100g: a.proteinas,
    carbsPer100g: a.carbohidratos,
    fatPer100g: a.grasas,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
export default function InventoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    inventory,
    products,
    addProduct,
    addToInventory,
    removeFromInventory,
    updateInventoryWeight,
    addConsumptionManual,
    esp32Connected,
    esp32ServerUrl,
    syncEsp32,
    activeProductOnScale,
    setActiveProductOnScale,
  } = useNutri();

  const [tab, setTab] = useState<Tab>("despensa");

  // INTA search
  const [dbSearch, setDbSearch] = useState("");
  const inSearchMode = dbSearch.trim().length > 0;
  const inResults: AlimentoINTA[] = inSearchMode ? buscarAlimento(dbSearch) : [];

  // Scanned/selected product modal (barcode lookup OR INTA selection)
  const [scanModal, setScanModal] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scannedProduct, setScannedProduct] = useState<ScannedProduct | null>(null);
  const [scanError, setScanError] = useState("");
  const [weightInput, setWeightInput] = useState("");
  const [scanStep, setScanStep] = useState<"input" | "result" | "consume" | "addDespensa">("input");

  // Add-to-despensa modal (from existing product in DB)
  const [addFromDbModal, setAddFromDbModal] = useState(false);
  const [addFromDbProduct, setAddFromDbProduct] = useState<Product | null>(null);
  const [addFromDbWeight, setAddFromDbWeight] = useState("");

  // Manual consume / restock modal
  const [actionModal, setActionModal] = useState<"consume" | "restock" | null>(null);
  const [actionItem, setActionItem] = useState<(typeof inventory)[0] | null>(null);
  const [actionWeight, setActionWeight] = useState("");

  // Add custom product modal
  const [addProductModal, setAddProductModal] = useState(false);
  const [form, setForm] = useState({
    name: "", brand: "", barcode: "",
    caloriesPer100g: "", proteinPer100g: "", carbsPer100g: "", fatPer100g: "",
  });

  // ESP32 URL modal
  const [urlModal, setUrlModal] = useState(false);
  const fullServerUrl = `${esp32ServerUrl}/api/nutritrack/reading`;

  // Camera barcode scanner
  const [cameraOpen, setCameraOpen] = useState(false);

  // Pulse animation for active product on scale
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!activeProductOnScale) { pulseAnim.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [activeProductOnScale, pulseAnim]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  function resetScan() {
    setBarcodeInput(""); setScannedProduct(null); setScanError("");
    setWeightInput(""); setScanStep("input");
  }

  function openINTAFood(a: AlimentoINTA) {
    setScannedProduct(alimentoToScanned(a));
    setScanStep("result");
    setScanModal(true);
    Haptics.selectionAsync();
  }

  async function handleLookup() {
    const code = barcodeInput.trim();
    if (!code) { setScanError("Ingresa un código de barras."); return; }
    setScanning(true); setScanError("");
    try {
      const result = await lookupBarcode(code, products);
      if (!result) {
        setScanError(`Código "${code}" no encontrado.\nPuedes agregarlo manualmente.`);
      } else {
        setScannedProduct(result);
        setScanStep("result");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } finally {
      setScanning(false);
    }
  }

  function scannedToLocalProduct(): Product {
    if (!scannedProduct) throw new Error("no product");
    const existing =
      products.find((p) => scannedProduct.barcode && p.barcode === scannedProduct.barcode) ??
      products.find((p) => p.name === scannedProduct.name);
    if (existing) return existing;
    return addProduct({
      name: scannedProduct.name,
      brand: scannedProduct.brand,
      barcode: scannedProduct.barcode,
      caloriesPer100g: scannedProduct.caloriesPer100g,
      proteinPer100g: scannedProduct.proteinPer100g,
      carbsPer100g: scannedProduct.carbsPer100g,
      fatPer100g: scannedProduct.fatPer100g,
    });
  }

  function handleLogConsumption() {
    if (!scannedProduct) return;
    const w = parseFloat(weightInput);
    if (isNaN(w) || w <= 0) {
      Alert.alert("Peso inválido", "Ingresa un peso mayor a 0g."); return;
    }
    const product = scannedToLocalProduct();
    addConsumptionManual(product, w);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setScanModal(false); resetScan();
    Alert.alert("¡Registrado!", `${w}g de ${scannedProduct.name} agregado al historial.`);
  }

  function handleAddToDespensa() {
    if (!scannedProduct) return;
    const w = parseFloat(weightInput);
    if (isNaN(w) || w <= 0) {
      Alert.alert("Peso inválido", "Ingresa el peso que tienes en casa."); return;
    }
    const product = scannedToLocalProduct();
    addToInventory(product, w);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setScanModal(false); resetScan(); setTab("despensa");
    Alert.alert("¡Agregado!", `${scannedProduct.name} está en tu despensa con ${w}g.`);
  }

  function handleAddFromDb() {
    if (!addFromDbProduct) return;
    const w = parseFloat(addFromDbWeight);
    if (isNaN(w) || w <= 0) {
      Alert.alert("Peso inválido", "Ingresa un peso mayor a 0g."); return;
    }
    addToInventory(addFromDbProduct, w);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAddFromDbModal(false); setAddFromDbProduct(null); setAddFromDbWeight(""); setTab("despensa");
    Alert.alert("¡Agregado!", `${addFromDbProduct.name} está en tu despensa con ${w}g.`);
  }

  function openAction(
    type: "consume" | "restock",
    item: (typeof inventory)[0]
  ) {
    setActionModal(type); setActionItem(item); setActionWeight("");
    Haptics.selectionAsync();
  }

  function confirmAction() {
    if (!actionItem || !actionModal) return;
    const w = parseFloat(actionWeight);
    if (isNaN(w) || w <= 0) {
      Alert.alert("Peso inválido", "Ingresa un peso mayor a 0g."); return;
    }
    if (actionModal === "consume") {
      // Log the consumption
      addConsumptionManual(actionItem.product, w);
      // Reduce the stock
      const newW = Math.max(0, actionItem.currentWeightG - w);
      updateInventoryWeight(actionItem.id, newW, "manual");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("✓ Registrado", `Consumiste ${w}g de ${actionItem.product.name}. Quedan ${newW}g.`);
    } else {
      // Restock: reset to new weight
      updateInventoryWeight(actionItem.id, w, "manual");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("✓ Repuesto", `${actionItem.product.name} actualizado a ${w}g.`);
    }
    setActionModal(null); setActionItem(null); setActionWeight("");
  }

  function handleRemove(itemId: string, name: string) {
    Alert.alert("Eliminar de la despensa", `¿Eliminar ${name}?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: () => {
          removeFromInventory(itemId);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        },
      },
    ]);
  }

  function handleAddProduct() {
    if (!form.name || !form.caloriesPer100g) {
      Alert.alert("Faltan datos", "El nombre y las calorías son obligatorios."); return;
    }
    addProduct({
      name: form.name.trim(),
      brand: form.brand.trim() || undefined,
      barcode: form.barcode.trim() || undefined,
      caloriesPer100g: parseFloat(form.caloriesPer100g) || 0,
      proteinPer100g: parseFloat(form.proteinPer100g) || 0,
      carbsPer100g: parseFloat(form.carbsPer100g) || 0,
      fatPer100g: parseFloat(form.fatPer100g) || 0,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setForm({ name: "", brand: "", barcode: "", caloriesPer100g: "", proteinPer100g: "", carbsPer100g: "", fatPer100g: "" });
    setAddProductModal(false);
  }

  // Preview macros while user types weight
  function previewMacros(product: ScannedProduct, w: string) {
    const g = parseFloat(w);
    if (isNaN(g) || g <= 0) return null;
    return {
      calories: Math.round(product.caloriesPer100g * g / 100),
      protein: Math.round(product.proteinPer100g * g / 100 * 10) / 10,
      carbs: Math.round(product.carbsPer100g * g / 100 * 10) / 10,
      fat: Math.round(product.fatPer100g * g / 100 * 10) / 10,
    };
  }

  // ─── Sub-components ────────────────────────────────────────────────────────
  const ProductMiniCard = ({ product, onAction }: { product: ScannedProduct; onAction: () => void }) => (
    <View style={[styles.miniCard, { backgroundColor: colors.secondary, borderColor: colors.primary }]}>
      <View style={styles.miniCardLeft}>
        <Text style={[styles.miniCardName, { color: colors.foreground }]} numberOfLines={1}>{product.name}</Text>
        {product.brand && <Text style={[styles.miniCardBrand, { color: colors.mutedForeground }]}>{product.brand}</Text>}
        {product.barcode
          ? <View style={styles.row}><Feather name="bar-chart-2" size={10} color={colors.mutedForeground} /><Text style={[styles.small, { color: colors.mutedForeground }]}>{product.barcode}</Text></View>
          : <View style={styles.row}><Feather name="book-open" size={10} color={colors.mutedForeground} /><Text style={[styles.small, { color: colors.mutedForeground }]}>Tabla INTA</Text></View>
        }
      </View>
      <View style={[styles.calBadge, { backgroundColor: colors.primary }]}>
        <Text style={styles.calBadgeNum}>{product.caloriesPer100g}</Text>
        <Text style={styles.calBadgeUnit}>kcal</Text>
      </View>
    </View>
  );

  const INTACard = ({ item }: { item: AlimentoINTA }) => (
    <Pressable style={[styles.intaCard, { backgroundColor: colors.card }]} onPress={() => openINTAFood(item)}>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={[styles.catBadge, { backgroundColor: colors.secondary }]}>
          <Text style={[styles.catBadgeText, { color: colors.primary }]}>{item.categoria}</Text>
        </View>
        <Text style={[styles.intaName, { color: colors.foreground }]}>{item.nombre}</Text>
        <Text style={[styles.small, { color: colors.mutedForeground }]}>
          P:{item.proteinas}g · C:{item.carbohidratos}g · G:{item.grasas}g
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <Text style={[styles.intaCal, { color: colors.primary }]}>{item.calorias} kcal</Text>
        <View style={[styles.addChip, { backgroundColor: colors.secondary }]}>
          <Feather name="plus" size={14} color={colors.primary} />
          <Text style={[styles.addChipText, { color: colors.primary }]}>Agregar</Text>
        </View>
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>

      {/* ─── Header ─── */}
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.primary }]}>
        <View>
          <Text style={styles.headerTitle}>Despensa</Text>
          <Pressable style={styles.row} onPress={() => setUrlModal(true)}>
            <View style={[styles.espDot, { backgroundColor: esp32Connected ? "#a8f0c0" : "rgba(255,255,255,0.4)" }]} />
            <Text style={styles.headerSub}>
              {esp32Connected ? "ESP32 sincronizando" : "Ver URL del servidor →"}
            </Text>
          </Pressable>
        </View>
        <View style={styles.headerBtns}>
          <Pressable
            style={[styles.iconBtn, { backgroundColor: "rgba(255,255,255,0.2)" }]}
            onPress={() => setCameraOpen(true)}
          >
            <Feather name="camera" size={18} color="#fff" />
          </Pressable>
          <Pressable
            style={[styles.iconBtn, { backgroundColor: "rgba(255,255,255,0.2)" }]}
            onPress={() => tab === "despensa" ? setTab("buscar") : setAddProductModal(true)}
          >
            <Feather name="plus" size={20} color="#fff" />
          </Pressable>
        </View>
      </View>

      {/* ─── ESP32 info banner ─── */}
      {!esp32Connected && (
        <Pressable
          style={[styles.esp32Banner, { backgroundColor: "#FFF8E6", borderColor: "#F0C040" }]}
          onPress={() => setUrlModal(true)}
        >
          <Feather name="wifi-off" size={14} color="#B8860B" />
          <View style={{ flex: 1 }}>
            <Text style={styles.esp32BannerTitle}>Conecta tu ESP32 al servidor</Text>
            <Text style={styles.esp32BannerUrl} numberOfLines={1}>{fullServerUrl}</Text>
          </View>
          <Text style={styles.esp32BannerRetry}>Ver URL →</Text>
        </Pressable>
      )}

      {/* ─── Tabs ─── */}
      <View style={[styles.tabBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {(["despensa", "buscar"] as Tab[]).map((t) => (
          <Pressable key={t} style={styles.tabItem} onPress={() => setTab(t)}>
            <Text style={[styles.tabLabel, { color: tab === t ? colors.primary : colors.mutedForeground }]}>
              {t === "despensa" ? `Despensa${inventory.length > 0 ? ` (${inventory.length})` : ""}` : "Buscar alimentos"}
            </Text>
            {tab === t && <View style={[styles.tabIndicator, { backgroundColor: colors.primary }]} />}
          </Pressable>
        ))}
      </View>

      {/* ═══════════════════════════════════════════════════════════════════════
          DESPENSA TAB
      ════════════════════════════════════════════════════════════════════════ */}
      {tab === "despensa" ? (
        <FlatList
          data={inventory}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 100 },
          ]}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="shopping-bag" size={44} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Tu despensa está vacía</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Busca alimentos con el botón + o en la pestaña "Buscar alimentos" para llenar tu despensa.
              </Text>
              <Pressable
                style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
                onPress={() => setTab("buscar")}
              >
                <Feather name="search" size={16} color="#fff" />
                <Text style={styles.emptyBtnText}>Buscar alimentos</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => {
            const pct = item.initialWeightG > 0 ? item.currentWeightG / item.initialWeightG : 0;
            const consumed = item.initialWeightG - item.currentWeightG;
            const isEsp32 = item.source === "esp32";
            const stockColor =
              pct < 0.15 ? colors.destructive : pct < 0.4 ? colors.carbs : colors.primary;

            return (
              <View style={[styles.despensaCard, { backgroundColor: colors.card }]}>

                {/* Header row */}
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.cardName, { color: colors.foreground }]}>{item.product.name}</Text>
                    {item.product.brand && (
                      <Text style={[styles.cardBrand, { color: colors.mutedForeground }]}>{item.product.brand}</Text>
                    )}
                  </View>
                  <View style={styles.cardHeaderRight}>
                    <View style={[styles.sourceBadge, { backgroundColor: isEsp32 ? "#E8F8F0" : colors.secondary }]}>
                      <Feather name={isEsp32 ? "zap" : "edit-2"} size={10} color={isEsp32 ? colors.primary : colors.mutedForeground} />
                      <Text style={[styles.sourceBadgeText, { color: isEsp32 ? colors.primary : colors.mutedForeground }]}>
                        {isEsp32 ? "ESP32" : "Manual"}
                      </Text>
                    </View>
                    <Pressable onPress={() => handleRemove(item.id, item.product.name)}>
                      <Feather name="trash-2" size={16} color={colors.destructive} />
                    </Pressable>
                  </View>
                </View>

                {/* Weight row */}
                <View style={styles.weightRow}>
                  <View style={styles.weightBlock}>
                    <Text style={[styles.weightBig, { color: stockColor }]}>{item.currentWeightG}g</Text>
                    <Text style={[styles.weightLabel, { color: colors.mutedForeground }]}>restante</Text>
                  </View>
                  <View style={styles.weightSep} />
                  <View style={styles.weightBlock}>
                    <Text style={[styles.weightMid, { color: colors.foreground }]}>{item.initialWeightG}g</Text>
                    <Text style={[styles.weightLabel, { color: colors.mutedForeground }]}>inicial</Text>
                  </View>
                  <View style={styles.weightSep} />
                  <View style={styles.weightBlock}>
                    <Text style={[styles.weightMid, { color: consumed > 0 ? colors.destructive : colors.mutedForeground }]}>
                      -{consumed}g
                    </Text>
                    <Text style={[styles.weightLabel, { color: colors.mutedForeground }]}>consumido</Text>
                  </View>
                </View>

                {/* Progress bar */}
                <View style={[styles.stockBar, { backgroundColor: colors.border }]}>
                  <View style={[styles.stockFill, { width: `${Math.min(pct * 100, 100)}%`, backgroundColor: stockColor }]} />
                </View>
                <Text style={[styles.stockPct, { color: stockColor }]}>
                  {Math.round(pct * 100)}% restante
                  {pct < 0.15 && "  ⚠️ Poco stock"}
                </Text>

                {/* Macros per 100g */}
                <View style={[styles.macroRow, { borderTopColor: colors.border }]}>
                  {[
                    { label: "Cal", value: `${item.product.caloriesPer100g}`, color: colors.calories },
                    { label: "P", value: `${item.product.proteinPer100g}g`, color: colors.protein },
                    { label: "C", value: `${item.product.carbsPer100g}g`, color: colors.carbs },
                    { label: "G", value: `${item.product.fatPer100g}g`, color: colors.fat },
                  ].map((m) => (
                    <View key={m.label} style={styles.macroChip}>
                      <Text style={[styles.macroVal, { color: m.color }]}>{m.value}</Text>
                      <Text style={[styles.macroLabel, { color: colors.mutedForeground }]}>/{m.label}</Text>
                    </View>
                  ))}
                  <Text style={[styles.per100, { color: colors.mutedForeground }]}>por 100g</Text>
                </View>

                {/* Poner en balanza / ESP32 button */}
                {(() => {
                  const isActive = activeProductOnScale?.id === item.id;
                  return (
                    <Pressable
                      style={[
                        styles.scaleBtn,
                        {
                          backgroundColor: isActive ? "#E8F8F0" : colors.secondary,
                          borderColor: isActive ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => {
                        if (isActive) {
                          setActiveProductOnScale(null);
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        } else {
                          setActiveProductOnScale(item);
                          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        }
                      }}
                    >
                      <Feather
                        name={isActive ? "zap" : "activity"}
                        size={15}
                        color={isActive ? colors.primary : colors.mutedForeground}
                      />
                      {isActive ? (
                        <>
                          <Text style={[styles.scaleBtnText, { color: colors.primary }]}>
                            En balanza — esperando ESP32
                          </Text>
                          <Animated.View
                            style={[styles.activeDot, { opacity: pulseAnim, backgroundColor: colors.primary }]}
                          />
                        </>
                      ) : (
                        <Text style={[styles.scaleBtnText, { color: colors.mutedForeground }]}>
                          Poner en balanza
                        </Text>
                      )}
                    </Pressable>
                  );
                })()}

                {/* Action buttons */}
                <View style={styles.actionBtnRow}>
                  <Pressable
                    style={[styles.actionBtn, { backgroundColor: colors.primary, flex: 1 }]}
                    onPress={() => openAction("consume", item)}
                  >
                    <Feather name="minus-circle" size={15} color="#fff" />
                    <Text style={styles.actionBtnWhite}>Consumir</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.actionBtn, { backgroundColor: colors.secondary, flex: 1 }]}
                    onPress={() => openAction("restock", item)}
                  >
                    <Feather name="refresh-cw" size={15} color={colors.primary} />
                    <Text style={[styles.actionBtnGreen, { color: colors.primary }]}>Reponer</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      ) : (
        /* ═══════════════════════════════════════════════════════════════════
           BUSCAR TAB
        ════════════════════════════════════════════════════════════════════ */
        <View style={{ flex: 1 }}>
          {/* Search bar */}
          <View style={[styles.searchWrap, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <View style={[styles.searchBox, { backgroundColor: colors.input, borderColor: colors.border }]}>
              <Feather name="search" size={16} color={colors.mutedForeground} />
              <TextInput
                style={[styles.searchText, { color: colors.foreground }]}
                value={dbSearch}
                onChangeText={setDbSearch}
                placeholder="Ej: pollo, arroz, manzana, leche..."
                placeholderTextColor={colors.mutedForeground}
                returnKeyType="search"
                autoCorrect={false}
              />
              {dbSearch.length > 0 && (
                <Pressable onPress={() => setDbSearch("")}>
                  <Feather name="x" size={16} color={colors.mutedForeground} />
                </Pressable>
              )}
            </View>
            <View style={[styles.infoChip, { backgroundColor: colors.secondary }]}>
              <Feather name="book-open" size={11} color={colors.primary} />
              <Text style={[styles.infoChipText, { color: colors.primary }]}>INTA · {ALIMENTOS.length} alimentos</Text>
            </View>
          </View>

          {!inSearchMode ? (
            <ScrollView
              contentContainerStyle={[
                styles.listContent,
                { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 100 },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Categorías</Text>
              <View style={styles.categoryGrid}>
                {["Carnes", "Aves", "Pescados", "Mariscos", "Lácteos", "Verduras", "Frutas", "Cereales", "Leguminosas", "Frutos secos", "Preparaciones", "Aceites y grasas"].map((cat) => (
                  <Pressable
                    key={cat}
                    style={[styles.catChip, { backgroundColor: colors.secondary }]}
                    onPress={() => setDbSearch(cat)}
                  >
                    <Text style={[styles.catChipText, { color: colors.primary }]}>{cat}</Text>
                  </Pressable>
                ))}
              </View>

              {products.length > 0 && (
                <>
                  <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 20 }]}>
                    Mis productos personalizados
                  </Text>
                  {products.map((p) => (
                    <View key={p.id} style={[styles.myProductCard, { backgroundColor: colors.card }]}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={[styles.cardName, { color: colors.foreground }]}>{p.name}</Text>
                        {p.brand && <Text style={[styles.cardBrand, { color: colors.mutedForeground }]}>{p.brand}</Text>}
                        {p.barcode
                          ? <View style={styles.row}><Feather name="bar-chart-2" size={10} color={colors.mutedForeground} /><Text style={[styles.small, { color: colors.mutedForeground }]}>{p.barcode}</Text></View>
                          : <View style={styles.row}><Feather name="user" size={10} color={colors.mutedForeground} /><Text style={[styles.small, { color: colors.mutedForeground }]}>Personalizado</Text></View>
                        }
                        <Text style={[styles.small, { color: colors.mutedForeground }]}>
                          {p.caloriesPer100g} kcal · P:{p.proteinPer100g}g C:{p.carbsPer100g}g G:{p.fatPer100g}g
                        </Text>
                      </View>
                      <Pressable
                        style={[styles.addChip, { backgroundColor: colors.primary }]}
                        onPress={() => { setAddFromDbProduct(p); setAddFromDbWeight(""); setAddFromDbModal(true); }}
                      >
                        <Feather name="plus" size={14} color="#fff" />
                        <Text style={[styles.addChipText, { color: "#fff" }]}>Agregar</Text>
                      </Pressable>
                    </View>
                  ))}
                </>
              )}

              <Pressable
                style={[styles.addCustomBtn, { borderColor: colors.border }]}
                onPress={() => setAddProductModal(true)}
              >
                <Feather name="plus-circle" size={16} color={colors.primary} />
                <Text style={[styles.addCustomText, { color: colors.primary }]}>
                  Agregar producto personalizado
                </Text>
              </Pressable>
            </ScrollView>
          ) : inResults.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="frown" size={36} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.mutedForeground }]}>Sin resultados</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No se encontró "{dbSearch}" en la tabla INTA.
              </Text>
              <Pressable
                style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
                onPress={() => setAddProductModal(true)}
              >
                <Text style={styles.emptyBtnText}>Agregar manualmente</Text>
              </Pressable>
            </View>
          ) : (
            <FlatList
              data={inResults}
              keyExtractor={(a) => a.id}
              contentContainerStyle={[
                styles.listContent,
                { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 100 },
              ]}
              ListHeaderComponent={
                <Text style={[styles.small, { color: colors.mutedForeground, marginBottom: 4 }]}>
                  {inResults.length} resultado{inResults.length !== 1 ? "s" : ""} para "{dbSearch}"
                </Text>
              }
              renderItem={({ item }) => <INTACard item={item} />}
            />
          )}
        </View>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          MODAL: URL del servidor ESP32
      ════════════════════════════════════════════════════════════════════════ */}
      <Modal visible={urlModal} transparent animationType="slide">
        <Pressable style={styles.overlay} onPress={() => setUrlModal(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.card }]} onPress={() => {}}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <View style={styles.row}>
              <View style={[styles.espDot, { width: 10, height: 10, borderRadius: 5, backgroundColor: esp32Connected ? colors.primary : "#E0A000" }]} />
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>URL del servidor ESP32</Text>
            </View>
            <Text style={[styles.small, { color: colors.mutedForeground }]}>
              Copia esta URL y pégala en el sketch Arduino como{" "}
              <Text style={{ fontFamily: "Inter_600SemiBold" }}>SERVER_URL</Text>
            </Text>

            {/* Selectable TextInput — el usuario puede mantener presionado y copiar */}
            <View style={[styles.urlBox, { backgroundColor: colors.secondary, borderColor: colors.primary }]}>
              <TextInput
                style={[styles.urlText, { color: colors.primary }]}
                value={fullServerUrl}
                editable={false}
                selectTextOnFocus
                multiline
              />
            </View>

            <Text style={[styles.small, { color: colors.mutedForeground, textAlign: "center" }]}>
              Mantén presionado el texto para seleccionar y copiar
            </Text>

            <Pressable
              style={[styles.confirmBtn, { backgroundColor: colors.primary }]}
              onPress={() =>
                Share.share({ message: fullServerUrl, title: "URL NutriTrack ESP32" })
              }
            >
              <Feather name="share-2" size={16} color="#fff" />
              <Text style={styles.confirmBtnText}>Compartir URL</Text>
            </Pressable>

            <Pressable
              style={[styles.confirmBtn, { backgroundColor: colors.secondary, marginTop: -6 }]}
              onPress={syncEsp32}
            >
              <Feather name="refresh-cw" size={16} color={colors.primary} />
              <Text style={[styles.confirmBtnText, { color: colors.primary }]}>
                {esp32Connected ? "Reconectar" : "Reintentar conexión"}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════════
          MODAL: Código de barras
      ════════════════════════════════════════════════════════════════════════ */}
      <Modal visible={scanModal} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
        <Pressable style={styles.overlay} onPress={() => { setScanModal(false); resetScan(); }}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.card }]} onPress={() => {}}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />

            {scanStep === "input" && (
              <>
                <View style={styles.row}>
                  <Feather name="hash" size={20} color={colors.primary} />
                  <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Ingresar código de barras</Text>
                </View>
                <Text style={[styles.small, { color: colors.mutedForeground }]}>
                  Escribe el número del código de barras del producto (parte inferior del código).
                </Text>
                <View style={styles.barcodeRow}>
                  <TextInput
                    style={[styles.barcodeInput, { borderColor: colors.border, backgroundColor: colors.input, color: colors.foreground, flex: 1 }]}
                    value={barcodeInput} onChangeText={setBarcodeInput}
                    placeholder="ej. 7802800053001" placeholderTextColor={colors.mutedForeground}
                    keyboardType="numeric" returnKeyType="search" onSubmitEditing={handleLookup} autoFocus
                  />
                  <Pressable style={[styles.searchBtn, { backgroundColor: colors.primary }]} onPress={handleLookup} disabled={scanning}>
                    {scanning ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="search" size={20} color="#fff" />}
                  </Pressable>
                </View>
                {scanError !== "" && (
                  <View style={[styles.errorBox, { borderColor: colors.destructive }]}>
                    <Feather name="alert-circle" size={13} color={colors.destructive} />
                    <Text style={[styles.small, { color: colors.destructive, flex: 1 }]}>{scanError}</Text>
                  </View>
                )}
                <View style={[styles.hintBox, { backgroundColor: colors.secondary }]}>
                  <Feather name="zap" size={12} color={colors.primary} />
                  <Text style={[styles.small, { color: colors.primary, flex: 1 }]}>
                    Con el ESP32 conectado, el escáner de hardware envía el código automáticamente.
                  </Text>
                </View>
              </>
            )}

            {scanStep === "result" && scannedProduct && (
              <>
                <ProductMiniCard product={scannedProduct} onAction={() => {}} />
                <Text style={[styles.sheetSubtitle, { color: colors.foreground }]}>¿Qué deseas hacer?</Text>
                <View style={styles.actionPair}>
                  {/* Opción 1: Agregar a la despensa (peso manual) */}
                  <Pressable
                    style={[styles.bigActionBtn, { backgroundColor: colors.primary }]}
                    onPress={() => { setScanStep("addDespensa"); setWeightInput(""); }}
                  >
                    <Feather name="shopping-bag" size={20} color="#fff" />
                    <Text style={styles.bigActionWhite}>Agregar a la despensa</Text>
                    <Text style={styles.bigActionSub}>Ingresa el peso manualmente</Text>
                  </Pressable>

                  {/* Opción 2: Pesar en balanza (ESP32 real-time) */}
                  <Pressable
                    style={[styles.bigActionBtn, { backgroundColor: "#E8F8F0", borderWidth: 2, borderColor: colors.primary }]}
                    onPress={() => {
                      const product = scannedToLocalProduct();
                      // Check if already in inventory, otherwise add with weight=0
                      const existing = inventory.find(
                        (i) => i.product.id === product.id ||
                                (product.barcode && i.product.barcode === product.barcode) ||
                                i.product.name.toLowerCase() === product.name.toLowerCase()
                      );
                      const invItem = existing ?? addToInventory(product, 0);
                      setActiveProductOnScale(invItem);
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      setScanModal(false); resetScan(); setTab("despensa");
                    }}
                  >
                    <Feather name="activity" size={20} color={colors.primary} />
                    <Text style={[styles.bigActionGreen, { color: colors.primary }]}>Pesar en balanza</Text>
                    <Text style={[styles.bigActionSub, { color: colors.mutedForeground }]}>ESP32 registra el peso en tiempo real</Text>
                  </Pressable>

                  {/* Opción 3: Solo registrar consumo */}
                  <Pressable
                    style={[styles.bigActionBtn, { backgroundColor: colors.secondary }]}
                    onPress={() => { setScanStep("consume"); setWeightInput(""); }}
                  >
                    <Feather name="plus-circle" size={20} color={colors.primary} />
                    <Text style={[styles.bigActionGreen, { color: colors.primary }]}>Solo registrar consumo</Text>
                    <Text style={[styles.bigActionSub, { color: colors.mutedForeground }]}>Ingresa los gramos consumidos</Text>
                  </Pressable>
                </View>
                <Pressable onPress={() => setScanStep("input")}>
                  <Text style={[styles.backLink, { color: colors.mutedForeground }]}>← Buscar otro código</Text>
                </Pressable>
              </>
            )}

            {scanStep === "addDespensa" && scannedProduct && (
              <>
                <ProductMiniCard product={scannedProduct} onAction={() => {}} />
                {weightInput !== "" && previewMacros(scannedProduct, weightInput) && (
                  <View style={[styles.previewBox, { backgroundColor: colors.secondary }]}>
                    <Feather name="package" size={13} color={colors.primary} />
                    <Text style={[styles.small, { color: colors.primary }]}>
                      {weightInput}g — {previewMacros(scannedProduct, weightInput)?.calories} kcal al consumirlo todo
                    </Text>
                  </View>
                )}
                <View style={{ gap: 4 }}>
                  <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>¿Cuánto tienes en casa? (gramos)</Text>
                  <TextInput
                    style={[styles.barcodeInput, { borderColor: colors.border, backgroundColor: colors.input, color: colors.foreground }]}
                    value={weightInput} onChangeText={setWeightInput}
                    placeholder="ej. 500" placeholderTextColor={colors.mutedForeground}
                    keyboardType="numeric" autoFocus
                  />
                </View>
                <Pressable style={[styles.confirmBtn, { backgroundColor: colors.primary }]} onPress={handleAddToDespensa}>
                  <Feather name="shopping-bag" size={18} color="#fff" />
                  <Text style={styles.confirmBtnText}>Agregar a mi despensa</Text>
                </Pressable>
                <Pressable onPress={() => setScanStep("result")}>
                  <Text style={[styles.backLink, { color: colors.mutedForeground }]}>← Volver</Text>
                </Pressable>
              </>
            )}

            {scanStep === "consume" && scannedProduct && (
              <>
                <ProductMiniCard product={scannedProduct} onAction={() => {}} />
                {weightInput !== "" && previewMacros(scannedProduct, weightInput) && (() => {
                  const m = previewMacros(scannedProduct, weightInput)!;
                  return (
                    <View style={[styles.previewBox, { backgroundColor: colors.secondary }]}>
                      <Feather name="trending-up" size={13} color={colors.primary} />
                      <Text style={[styles.small, { color: colors.primary }]}>
                        {m.calories} kcal · P:{m.protein}g · C:{m.carbs}g · G:{m.fat}g
                      </Text>
                    </View>
                  );
                })()}
                <View style={{ gap: 4 }}>
                  <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>¿Cuánto consumiste? (gramos)</Text>
                  <TextInput
                    style={[styles.barcodeInput, { borderColor: colors.border, backgroundColor: colors.input, color: colors.foreground }]}
                    value={weightInput} onChangeText={setWeightInput}
                    placeholder="ej. 150" placeholderTextColor={colors.mutedForeground}
                    keyboardType="numeric" autoFocus
                  />
                </View>
                <Pressable style={[styles.confirmBtn, { backgroundColor: colors.primary }]} onPress={handleLogConsumption}>
                  <Feather name="check-circle" size={18} color="#fff" />
                  <Text style={styles.confirmBtnText}>Registrar en historial</Text>
                </Pressable>
                <Pressable onPress={() => setScanStep("result")}>
                  <Text style={[styles.backLink, { color: colors.mutedForeground }]}>← Volver</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════════
          MODAL: Agregar desde mis productos al inventario
      ════════════════════════════════════════════════════════════════════════ */}
      <Modal visible={addFromDbModal} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <Pressable style={styles.overlay} onPress={() => { setAddFromDbModal(false); setAddFromDbProduct(null); }}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.card }]} onPress={() => {}}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Agregar a la despensa</Text>
            {addFromDbProduct && (
              <View style={[styles.selectedBadge, { backgroundColor: colors.secondary }]}>
                <Feather name="check-circle" size={16} color={colors.primary} />
                <Text style={[styles.selectedName, { color: colors.primary }]}>{addFromDbProduct.name}</Text>
              </View>
            )}
            <View style={{ gap: 4 }}>
              <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>¿Cuánto tienes en casa? (gramos)</Text>
              <TextInput
                style={[styles.barcodeInput, { borderColor: colors.border, backgroundColor: colors.input, color: colors.foreground }]}
                value={addFromDbWeight} onChangeText={setAddFromDbWeight}
                placeholder="ej. 500" placeholderTextColor={colors.mutedForeground}
                keyboardType="numeric" autoFocus
              />
            </View>
            <Pressable style={[styles.confirmBtn, { backgroundColor: colors.primary }]} onPress={handleAddFromDb}>
              <Feather name="shopping-bag" size={18} color="#fff" />
              <Text style={styles.confirmBtnText}>Agregar a mi despensa</Text>
            </Pressable>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════════
          MODAL: Consumir / Reponer
      ════════════════════════════════════════════════════════════════════════ */}
      <Modal visible={actionModal !== null} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <Pressable style={styles.overlay} onPress={() => { setActionModal(null); setActionItem(null); }}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.card }]} onPress={() => {}}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <View style={styles.row}>
              <Feather
                name={actionModal === "consume" ? "minus-circle" : "refresh-cw"}
                size={20}
                color={actionModal === "consume" ? colors.destructive : colors.primary}
              />
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                {actionModal === "consume" ? "Registrar consumo" : "Reponer stock"}
              </Text>
            </View>
            {actionItem && (
              <View style={[styles.selectedBadge, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.selectedName, { color: colors.primary }]}>{actionItem.product.name}</Text>
                <Text style={[styles.small, { color: colors.mutedForeground }]}>Stock actual: {actionItem.currentWeightG}g</Text>
              </View>
            )}
            {actionModal === "consume" && actionItem && actionWeight !== "" && previewMacros(actionItem.product as ScannedProduct, actionWeight) && (() => {
              const m = previewMacros(actionItem.product as ScannedProduct, actionWeight)!;
              return (
                <View style={[styles.previewBox, { backgroundColor: colors.secondary }]}>
                  <Feather name="trending-up" size={13} color={colors.primary} />
                  <Text style={[styles.small, { color: colors.primary }]}>
                    {m.calories} kcal · P:{m.protein}g · C:{m.carbs}g · G:{m.fat}g
                  </Text>
                </View>
              );
            })()}
            <View style={{ gap: 4 }}>
              <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>
                {actionModal === "consume" ? "¿Cuánto consumiste? (g)" : "Nuevo peso total en casa (g)"}
              </Text>
              <TextInput
                style={[styles.barcodeInput, { borderColor: colors.border, backgroundColor: colors.input, color: colors.foreground }]}
                value={actionWeight} onChangeText={setActionWeight}
                placeholder={actionModal === "consume" ? "ej. 150" : "ej. 500"}
                placeholderTextColor={colors.mutedForeground}
                keyboardType="numeric" autoFocus
              />
            </View>
            <Pressable
              style={[styles.confirmBtn, { backgroundColor: actionModal === "consume" ? colors.primary : colors.secondary }]}
              onPress={confirmAction}
            >
              <Feather
                name={actionModal === "consume" ? "check-circle" : "refresh-cw"}
                size={18}
                color={actionModal === "consume" ? "#fff" : colors.primary}
              />
              <Text style={[styles.confirmBtnText, { color: actionModal === "consume" ? "#fff" : colors.primary }]}>
                {actionModal === "consume" ? "Registrar consumo" : "Actualizar stock"}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════════
          MODAL: Producto personalizado
      ════════════════════════════════════════════════════════════════════════ */}
      <Modal visible={addProductModal} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <Pressable style={styles.overlay} onPress={() => setAddProductModal(false)}>
          <ScrollView
            style={[styles.scrollSheet, { backgroundColor: colors.card }]}
            contentContainerStyle={{ gap: 14, paddingHorizontal: 24, paddingBottom: 40, paddingTop: 12 }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.handle, { backgroundColor: colors.border, alignSelf: "center" }]} />
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Producto personalizado</Text>
            <F label="Nombre *" value={form.name} set={(t) => setForm({ ...form, name: t })} colors={colors} placeholder="ej. Pechuga de Pollo" />
            <F label="Marca" value={form.brand} set={(t) => setForm({ ...form, brand: t })} colors={colors} placeholder="ej. Super Pollo" />
            <F label="Código de barras" value={form.barcode} set={(t) => setForm({ ...form, barcode: t })} colors={colors} placeholder="ej. 7802..." kb="numeric" />
            <Text style={[styles.inputLabel, { color: colors.mutedForeground, marginTop: 4 }]}>
              Información nutricional por 100g
            </Text>
            <View style={styles.twoCol}>
              <View style={{ flex: 1 }}><F label="Calorías *" value={form.caloriesPer100g} set={(t) => setForm({ ...form, caloriesPer100g: t })} colors={colors} placeholder="kcal" kb="numeric" /></View>
              <View style={{ flex: 1 }}><F label="Proteínas (g)" value={form.proteinPer100g} set={(t) => setForm({ ...form, proteinPer100g: t })} colors={colors} placeholder="g" kb="numeric" /></View>
            </View>
            <View style={styles.twoCol}>
              <View style={{ flex: 1 }}><F label="Carbohidratos (g)" value={form.carbsPer100g} set={(t) => setForm({ ...form, carbsPer100g: t })} colors={colors} placeholder="g" kb="numeric" /></View>
              <View style={{ flex: 1 }}><F label="Grasas (g)" value={form.fatPer100g} set={(t) => setForm({ ...form, fatPer100g: t })} colors={colors} placeholder="g" kb="numeric" /></View>
            </View>
            <Pressable style={[styles.confirmBtn, { backgroundColor: colors.primary }]} onPress={handleAddProduct}>
              <Text style={styles.confirmBtnText}>Guardar producto</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ═══════════════════════════════════════════════════════════════════════
          MODAL: Escáner de código de barras (cámara)
      ════════════════════════════════════════════════════════════════════════ */}
      <Modal visible={cameraOpen} animationType="slide" statusBarTranslucent>
        <BarcodeScanner
          onScan={async (barcode) => {
            setCameraOpen(false);
            setBarcodeInput(barcode);
            setScanning(true); setScanError(""); setScannedProduct(null);
            setScanStep("input");
            try {
              const result = await lookupBarcode(barcode, products);
              if (!result) {
                setScanError(`Código "${barcode}" no encontrado.\nPuedes crearlo manualmente.`);
              } else {
                setScannedProduct(result);
                setScanStep("result");
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
            } finally {
              setScanning(false);
              setScanModal(true);
            }
          }}
          onClose={() => setCameraOpen(false)}
        />
      </Modal>
    </View>
  );
}

function F({
  label, value, set, colors, placeholder, kb,
}: {
  label: string; value: string; set: (t: string) => void;
  colors: ReturnType<typeof useColors>; placeholder?: string; kb?: "numeric";
}) {
  return (
    <View style={{ gap: 3 }}>
      <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        style={[styles.barcodeInput, { borderColor: colors.border, backgroundColor: colors.input, color: colors.foreground }]}
        value={value} onChangeText={set} placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground} keyboardType={kb ?? "default"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  small: { fontSize: 11, fontFamily: "Inter_400Regular" },

  // Header
  header: { paddingHorizontal: 20, paddingBottom: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)" },
  espDot: { width: 6, height: 6, borderRadius: 3 },
  headerBtns: { flexDirection: "row", gap: 8 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },

  // ESP32 banner
  esp32Banner: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  esp32BannerTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#B8860B" },
  esp32BannerUrl: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#B8860B" },
  esp32BannerRetry: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#B8860B" },

  // Tabs
  tabBar: { flexDirection: "row", borderBottomWidth: 1 },
  tabItem: { flex: 1, alignItems: "center", paddingVertical: 14, position: "relative" },
  tabLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  tabIndicator: { position: "absolute", bottom: 0, left: 20, right: 20, height: 2.5, borderRadius: 2 },

  // Lists
  listContent: { padding: 16, gap: 12 },
  emptyState: { alignItems: "center", paddingTop: 64, gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },

  // Despensa card
  despensaCard: { borderRadius: 18, padding: 16, gap: 10, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start" },
  cardHeaderRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardName: { fontSize: 16, fontFamily: "Inter_700Bold" },
  cardBrand: { fontSize: 12, fontFamily: "Inter_400Regular" },
  sourceBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  sourceBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  weightRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  weightBlock: { flex: 1, alignItems: "center", gap: 2 },
  weightSep: { width: 1, height: 32, backgroundColor: "#E0E0E0" },
  weightBig: { fontSize: 20, fontFamily: "Inter_700Bold" },
  weightMid: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  weightLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  stockBar: { height: 8, borderRadius: 4, overflow: "hidden" },
  stockFill: { height: 8, borderRadius: 4 },
  stockPct: { fontSize: 12, fontFamily: "Inter_500Medium" },
  macroRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 10, borderTopWidth: 1 },
  macroChip: { flexDirection: "row", alignItems: "baseline", gap: 1 },
  macroVal: { fontSize: 13, fontFamily: "Inter_700Bold" },
  macroLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  per100: { fontSize: 10, fontFamily: "Inter_400Regular", marginLeft: "auto" },
  actionBtnRow: { flexDirection: "row", gap: 8 },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10 },
  actionBtnWhite: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  actionBtnGreen: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // Search
  searchWrap: { padding: 12, gap: 8, borderBottomWidth: 1 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  searchText: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  infoChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, alignSelf: "flex-start" },
  infoChipText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 8 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  catChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  catChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // INTA cards
  intaCard: { borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  intaName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  intaCal: { fontSize: 15, fontFamily: "Inter_700Bold" },
  catBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start" },
  catBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  addChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  addChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  // My products card
  myProductCard: { borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  addCustomBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 16, borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed", marginTop: 8 },
  addCustomText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // Mini card in modal
  miniCard: { borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5 },
  miniCardLeft: { flex: 1, gap: 2 },
  miniCardName: { fontSize: 15, fontFamily: "Inter_700Bold" },
  miniCardBrand: { fontSize: 12, fontFamily: "Inter_400Regular" },
  calBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, alignItems: "center" },
  calBadgeNum: { color: "#fff", fontSize: 18, fontFamily: "Inter_700Bold" },
  calBadgeUnit: { color: "rgba(255,255,255,0.8)", fontSize: 10, fontFamily: "Inter_400Regular" },

  // Modal (bottom sheet)
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { borderRadius: 24, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, padding: 24, paddingTop: 12, gap: 14 },
  scrollSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%" },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  // URL box
  urlBox: { borderWidth: 2, borderRadius: 12, padding: 14 },
  urlText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  // Scale / active product
  scaleBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  scaleBtnText: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
  sheetTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  sheetSubtitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  barcodeRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  barcodeInput: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, fontFamily: "Inter_400Regular" },
  searchBtn: { width: 50, height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  errorBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: 10, padding: 10, backgroundColor: "#FFF3F3" },
  hintBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, padding: 12 },
  actionPair: { gap: 10 },
  bigActionBtn: { borderRadius: 16, padding: 16, alignItems: "center", gap: 4 },
  bigActionWhite: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  bigActionGreen: { fontSize: 15, fontFamily: "Inter_700Bold" },
  bigActionSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)" },
  previewBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, padding: 12 },
  inputLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  confirmBtn: { paddingVertical: 16, borderRadius: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
  confirmBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  selectedBadge: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  selectedName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  backLink: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  twoCol: { flexDirection: "row", gap: 12 },
});
