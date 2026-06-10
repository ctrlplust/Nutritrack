import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type Sex = "male" | "female";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "veryActive";

export interface Profile {
  id: string;
  name: string;
  calorieGoal: number;
  proteinGoal: number;
  carbsGoal: number;
  fatGoal: number;
  heightCm?: number;
  weightKg?: number;
  age?: number;
  sex?: Sex;
  activityLevel?: ActivityLevel;
}

export interface Product {
  id: string;
  barcode?: string;
  name: string;
  brand?: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
}

export interface InventoryItem {
  id: string;
  product: Product;
  currentWeightG: number;
  initialWeightG: number;
  lastUpdated: string;
  source?: "esp32" | "manual";
}

export interface Consumption {
  id: string;
  profileId: string;
  product: Product;
  weightConsumedG: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  timestamp: string;
  source?: "esp32" | "manual";
}

interface DailyTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface TDEE {
  bmr: number;
  tdee: number;
  calories: number;
  proteinGoal: number;
  carbsGoal: number;
  fatGoal: number;
}

// Shape of consumptions returned by the API server
interface ServerConsumption {
  id: string;
  productId: string;
  productName: string;
  weightConsumedG: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  weightBefore: number;
  weightAfter: number;
  deviceId?: string;
  timestamp: string;
}

interface NutriContextType {
  profiles: Profile[];
  currentProfile: Profile | null;
  products: Product[];
  inventory: InventoryItem[];
  consumptions: Consumption[];
  todayTotals: DailyTotals;
  loading: boolean;
  esp32Connected: boolean;
  esp32ServerUrl: string;
  activeProductOnScale: InventoryItem | null;
  setActiveProductOnScale: (item: InventoryItem | null) => Promise<void>;
  switchProfile: (id: string) => void;
  addProfile: (p: Omit<Profile, "id">) => void;
  updateProfile: (p: Profile) => void;
  addProduct: (p: Omit<Product, "id">) => Product;
  addToInventory: (product: Product, weightG: number) => InventoryItem;
  removeFromInventory: (itemId: string) => void;
  updateInventoryWeight: (itemId: string, newWeightG: number, source?: "esp32" | "manual") => void;
  simulateReading: (itemId: string, newWeightG: number) => void;
  addConsumptionManual: (product: Product, weightG: number) => void;
  deleteConsumption: (id: string) => void;
  syncEsp32: () => Promise<void>;
}

const NutriContext = createContext<NutriContextType | null>(null);

const KEYS = {
  profiles: "nutritrack_profiles",
  currentProfileId: "nutritrack_current_profile",
  products: "nutritrack_products",
  inventory: "nutritrack_inventory",
  consumptions: "nutritrack_consumptions",
};

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  veryActive: 1.9,
};

export function calcTDEE(p: Partial<Profile>): TDEE | null {
  if (!p.heightCm || !p.weightKg || !p.age || !p.sex || !p.activityLevel) return null;
  const bmr =
    p.sex === "male"
      ? 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + 5
      : 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age - 161;
  const tdee = Math.round(bmr * ACTIVITY_MULTIPLIERS[p.activityLevel]);
  const protein = Math.round((tdee * 0.25) / 4);
  const fat = Math.round((tdee * 0.30) / 9);
  const carbs = Math.round((tdee * 0.45) / 4);
  return { bmr: Math.round(bmr), tdee, calories: tdee, proteinGoal: protein, carbsGoal: carbs, fatGoal: fat };
}

const SAMPLE_PRODUCTS: Product[] = [
  { id: "p1", barcode: "7802800053001", name: "Pechuga de Pollo", brand: "Super Pollo", caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6 },
  { id: "p2", barcode: "7802800012345", name: "Arroz Integral", brand: "Carozzi", caloriesPer100g: 362, proteinPer100g: 7.5, carbsPer100g: 76, fatPer100g: 2.7 },
  { id: "p3", barcode: "7802800099001", name: "Avena Tradicional", brand: "Quaker", caloriesPer100g: 389, proteinPer100g: 17, carbsPer100g: 66, fatPer100g: 7 },
  { id: "p4", barcode: "7802800055555", name: "Aceite de Oliva", brand: "Borges", caloriesPer100g: 884, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 100 },
  { id: "p5", barcode: "7802800011111", name: "Huevo Entero", brand: "Sopraval", caloriesPer100g: 155, proteinPer100g: 13, carbsPer100g: 1.1, fatPer100g: 11 },
  { id: "p6", barcode: "7802800022222", name: "Whey Protein Chocolate", brand: "Optimum Nutrition", caloriesPer100g: 380, proteinPer100g: 75, carbsPer100g: 8, fatPer100g: 5 },
  { id: "p7", barcode: "7802800033333", name: "Salmón Fresco", brand: "AquaChile", caloriesPer100g: 208, proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 13 },
  { id: "p8", barcode: "7802800044444", name: "Yogurt Griego Natural", brand: "Nestlé", caloriesPer100g: 97, proteinPer100g: 9, carbsPer100g: 4, fatPer100g: 5 },
  { id: "p9", barcode: "7802800066666", name: "Quinoa Cocida", brand: "Granos del Sol", caloriesPer100g: 120, proteinPer100g: 4.4, carbsPer100g: 21.3, fatPer100g: 1.9 },
  { id: "p10", barcode: "7802800077777", name: "Almendras", brand: "Planters", caloriesPer100g: 579, proteinPer100g: 21, carbsPer100g: 22, fatPer100g: 50 },
];

const SAMPLE_PROFILES: Profile[] = [
  {
    id: "prof1",
    name: "Tomás Núñez",
    calorieGoal: 2800,
    proteinGoal: 200,
    carbsGoal: 300,
    fatGoal: 80,
    heightCm: 175,
    weightKg: 75,
    age: 22,
    sex: "male",
    activityLevel: "moderate",
  },
];

function calcMacros(product: Product, weightG: number) {
  const factor = weightG / 100;
  return {
    calories: Math.round(product.caloriesPer100g * factor),
    protein: Math.round(product.proteinPer100g * factor * 10) / 10,
    carbs: Math.round(product.carbsPer100g * factor * 10) / 10,
    fat: Math.round(product.fatPer100g * factor * 10) / 10,
  };
}

function uid() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function isSameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

// Derive per-100g values from a server consumption record
function serverConsumptionToProduct(sc: ServerConsumption): Product {
  const w = sc.weightConsumedG > 0 ? sc.weightConsumedG : 100;
  return {
    id: "esp32-" + sc.productId,
    name: sc.productName,
    caloriesPer100g: Math.round((sc.calories / w) * 100),
    proteinPer100g: Math.round((sc.protein / w) * 100 * 10) / 10,
    carbsPer100g: Math.round((sc.carbs / w) * 100 * 10) / 10,
    fatPer100g: Math.round((sc.fat / w) * 100 * 10) / 10,
  };
}

export function NutriProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [consumptions, setConsumptions] = useState<Consumption[]>([]);
  const [loading, setLoading] = useState(true);
  const [esp32Connected, setEsp32Connected] = useState(false);
  const [activeProductOnScale, setActiveProductOnScaleState] = useState<InventoryItem | null>(null);

  // Use a ref so the polling closure never goes stale
  const lastSyncRef = useRef<string>(new Date(Date.now() - 60 * 1000).toISOString());
  const currentProfileIdRef = useRef<string | null>(null);
  currentProfileIdRef.current = currentProfileId;

  // Keep products accessible in async callbacks without stale closure
  const productsRef = useRef<Product[]>([]);
  productsRef.current = products;

  // Track whether we've synced products to the server in this session
  const productsSyncedRef = useRef(false);

  const esp32ServerUrl = "https://vbyfr-201-188-83-149.run.pinggy-free.link";

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [pStr, cpStr, prodStr, invStr, conStr] = await Promise.all([
        AsyncStorage.getItem(KEYS.profiles),
        AsyncStorage.getItem(KEYS.currentProfileId),
        AsyncStorage.getItem(KEYS.products),
        AsyncStorage.getItem(KEYS.inventory),
        AsyncStorage.getItem(KEYS.consumptions),
      ]);
      const loadedProfiles: Profile[] = pStr ? JSON.parse(pStr) : SAMPLE_PROFILES;
      const loadedProducts: Product[] = prodStr ? JSON.parse(prodStr) : SAMPLE_PRODUCTS;
      const loadedInventory: InventoryItem[] = invStr ? JSON.parse(invStr) : [];
      const loadedConsumptions: Consumption[] = conStr ? JSON.parse(conStr) : [];
      const loadedCurrentId: string | null = cpStr || loadedProfiles[0]?.id || null;

      if (!pStr) await AsyncStorage.setItem(KEYS.profiles, JSON.stringify(loadedProfiles));
      if (!prodStr) await AsyncStorage.setItem(KEYS.products, JSON.stringify(loadedProducts));
      if (!cpStr && loadedCurrentId) await AsyncStorage.setItem(KEYS.currentProfileId, loadedCurrentId);

      setProfiles(loadedProfiles);
      setCurrentProfileId(loadedCurrentId);
      setProducts(loadedProducts);
      setInventory(loadedInventory);
      setConsumptions(loadedConsumptions);
    } catch (_e) {
    } finally {
      setLoading(false);
    }
  }

  // ─── Sync local products → server (so ESP32 hardcoded productName gets macros) ──
  const syncProductsToServer = useCallback(async () => {
    const localProducts = productsRef.current;
    if (localProducts.length === 0) return;
    try {
      await Promise.all(
        localProducts.map((p) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);
          return fetch(`${esp32ServerUrl}/api/nutritrack/products`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              barcode: p.barcode ?? "local-" + p.id,
              name: p.name,
              brand: p.brand,
              caloriesPer100g: p.caloriesPer100g,
              proteinPer100g: p.proteinPer100g,
              carbsPer100g: p.carbsPer100g,
              fatPer100g: p.fatPer100g,
            }),
            signal: controller.signal,
          }).finally(() => clearTimeout(timeoutId)).catch(() => {});
        })
      );
      productsSyncedRef.current = true;
    } catch (_e) {}
  }, [esp32ServerUrl]);

// ─── ESP32 Polling ─────────────────────────────────────────────────────────
  const syncEsp32 = useCallback(async () => {
    const profileId = currentProfileIdRef.current;
    if (!profileId) return;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const since = encodeURIComponent(lastSyncRef.current);
      console.log("🚨 ATENCIÓN: Intentando conectar a:", esp32ServerUrl);
      console.log("Ruta completa:", `${esp32ServerUrl}/api/nutritrack/consumptions?since=${since}`);
      const res = await fetch(`${esp32ServerUrl}/api/nutritrack/consumptions?since=${since}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) { 
        setEsp32Connected(false); 
        productsSyncedRef.current = false; 
        console.error("Servidor respondió, pero con error:", res.status);
        return; 
      }

      // On first successful connect (or after reconnect), push local products
      // so the server knows about "Pechuga de Pollo" and other named products
      if (!productsSyncedRef.current) {
        syncProductsToServer();
      }
      setEsp32Connected(true);
      const data = await res.json();
      const serverList: ServerConsumption[] = data.consumptions ?? [];
      if (serverList.length === 0) return;

      // Build local consumption records from server data
      const toAdd: Consumption[] = serverList.map((sc) => ({
        id: "esp32-" + sc.id,
        profileId,
        product: serverConsumptionToProduct(sc),
        weightConsumedG: sc.weightConsumedG,
        calories: sc.calories,
        protein: sc.protein,
        carbs: sc.carbs,
        fat: sc.fat,
        timestamp: sc.timestamp,
        source: "esp32" as const,
      }));

      setConsumptions((prev) => {
        const existingIds = new Set(prev.map((c) => c.id));
        const fresh = toAdd.filter((c) => !existingIds.has(c.id));
        if (fresh.length === 0) return prev;
        const next = [...fresh, ...prev];
        AsyncStorage.setItem(KEYS.consumptions, JSON.stringify(next));
        return next;
      });

      // Update matching inventory items (by product name)
      // Also auto-add items for products not yet in local inventory
      setInventory((prev) => {
        let changed = false;
        const updated = prev.map((item) => {
          const match = serverList.find(
            (sc) => sc.productName.toLowerCase() === item.product.name.toLowerCase()
          );
          if (!match) return item;
          changed = true;
          return {
            ...item,
            currentWeightG: Math.max(0, match.weightAfter),
            initialWeightG: Math.max(item.initialWeightG, match.weightBefore),
            lastUpdated: match.timestamp,
            source: "esp32" as const,
          };
        });

        // Auto-add new inventory items for products not yet tracked locally
        const existingNames = new Set(prev.map((i) => i.product.name.toLowerCase()));
        const newItems: InventoryItem[] = serverList
          .filter((sc) => !existingNames.has(sc.productName.toLowerCase()) && sc.weightAfter >= 0)
          .map((sc) => ({
            id: "esp32-inv-" + uid(),
            product: serverConsumptionToProduct(sc),
            currentWeightG: Math.max(0, sc.weightAfter),
            initialWeightG: Math.max(0, sc.weightBefore),
            lastUpdated: sc.timestamp,
            source: "esp32" as const,
          }));

        if (newItems.length > 0) changed = true;
        const next = [...updated, ...newItems];
        if (!changed) return prev;
        AsyncStorage.setItem(KEYS.inventory, JSON.stringify(next));
        return next;
      });

      // Advance the sync window so we don't re-process the same records
      lastSyncRef.current = new Date().toISOString();
    } catch (error) {
      setEsp32Connected(false);
      productsSyncedRef.current = false;
      clearTimeout(timeoutId);
      console.error("Fallo catastrófico del fetch:", error);
    }
  }, [esp32ServerUrl])

  useEffect(() => {
    // Initial check after 2s (let data load first), then every 5s
    const init = setTimeout(() => syncEsp32(), 2000);
    const interval = setInterval(syncEsp32, 5000);
    return () => { clearTimeout(init); clearInterval(interval); };
  }, [syncEsp32]);

  // ─── Derived state ─────────────────────────────────────────────────────────
  const currentProfile = profiles.find((p) => p.id === currentProfileId) ?? null;

  const todayTotals: DailyTotals = consumptions
    .filter(
      (c) =>
        c.profileId === currentProfileId &&
        isSameDay(c.timestamp, new Date().toISOString())
    )
    .reduce(
      (acc, c) => ({
        calories: acc.calories + c.calories,
        protein: acc.protein + c.protein,
        carbs: acc.carbs + c.carbs,
        fat: acc.fat + c.fat,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );

  // ─── Actions ───────────────────────────────────────────────────────────────
  const switchProfile = useCallback(async (id: string) => {
    setCurrentProfileId(id);
    await AsyncStorage.setItem(KEYS.currentProfileId, id);
  }, []);

  const addProfile = useCallback(async (p: Omit<Profile, "id">) => {
    const newProfile = { ...p, id: uid() };
    setProfiles((prev) => {
      const next = [...prev, newProfile];
      AsyncStorage.setItem(KEYS.profiles, JSON.stringify(next));
      return next;
    });
  }, []);

  const updateProfile = useCallback(async (p: Profile) => {
    setProfiles((prev) => {
      const next = prev.map((x) => (x.id === p.id ? p : x));
      AsyncStorage.setItem(KEYS.profiles, JSON.stringify(next));
      return next;
    });
  }, []);

  const addProduct = useCallback((p: Omit<Product, "id">): Product => {
    const newProduct = { ...p, id: uid() };
    setProducts((prev) => {
      const next = [...prev, newProduct];
      AsyncStorage.setItem(KEYS.products, JSON.stringify(next));
      return next;
    });
    return newProduct;
  }, []);

  const addToInventory = useCallback((product: Product, weightG: number): InventoryItem => {
    const item: InventoryItem = {
      id: uid(),
      product,
      currentWeightG: weightG,
      initialWeightG: weightG,
      lastUpdated: new Date().toISOString(),
      source: "manual",
    };
    setInventory((prev) => {
      const next = [...prev, item];
      AsyncStorage.setItem(KEYS.inventory, JSON.stringify(next));
      return next;
    });
    return item;
  }, []);

  const removeFromInventory = useCallback(async (itemId: string) => {
    setInventory((prev) => {
      const next = prev.filter((i) => i.id !== itemId);
      AsyncStorage.setItem(KEYS.inventory, JSON.stringify(next));
      return next;
    });
  }, []);

  const updateInventoryWeight = useCallback(
    (itemId: string, newWeightG: number, source: "esp32" | "manual" = "manual") => {
      setInventory((prev) => {
        const next = prev.map((i) =>
          i.id === itemId
            ? { ...i, currentWeightG: Math.max(0, newWeightG), lastUpdated: new Date().toISOString(), source }
            : i
        );
        AsyncStorage.setItem(KEYS.inventory, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  const simulateReading = useCallback(
    async (itemId: string, newWeightG: number) => {
      if (!currentProfileId) return;
      setInventory((prevInv) => {
        const item = prevInv.find((i) => i.id === itemId);
        if (!item) return prevInv;
        const delta = item.currentWeightG - newWeightG;
        if (delta <= 0) return prevInv;
        const macros = calcMacros(item.product, delta);
        const consumption: Consumption = {
          id: uid(),
          profileId: currentProfileId,
          product: item.product,
          weightConsumedG: delta,
          ...macros,
          timestamp: new Date().toISOString(),
          source: "manual",
        };
        setConsumptions((prevCons) => {
          const next = [consumption, ...prevCons];
          AsyncStorage.setItem(KEYS.consumptions, JSON.stringify(next));
          return next;
        });
        const updatedItem: InventoryItem = {
          ...item,
          currentWeightG: newWeightG,
          lastUpdated: new Date().toISOString(),
        };
        const nextInv = prevInv.map((i) => (i.id === itemId ? updatedItem : i));
        AsyncStorage.setItem(KEYS.inventory, JSON.stringify(nextInv));
        return nextInv;
      });
    },
    [currentProfileId]
  );

  const addConsumptionManual = useCallback(
    async (product: Product, weightG: number) => {
      if (!currentProfileId) return;
      const macros = calcMacros(product, weightG);
      const consumption: Consumption = {
        id: uid(),
        profileId: currentProfileId,
        product,
        weightConsumedG: weightG,
        ...macros,
        timestamp: new Date().toISOString(),
        source: "manual",
      };
      setConsumptions((prev) => {
        const next = [consumption, ...prev];
        AsyncStorage.setItem(KEYS.consumptions, JSON.stringify(next));
        return next;
      });
    },
    [currentProfileId]
  );

  const deleteConsumption = useCallback(async (id: string) => {
    setConsumptions((prev) => {
      const next = prev.filter((c) => c.id !== id);
      AsyncStorage.setItem(KEYS.consumptions, JSON.stringify(next));
      return next;
    });
  }, []);

  const setActiveProductOnScale = useCallback(async (item: InventoryItem | null) => {
    setActiveProductOnScaleState(item);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const body = item
        ? { barcode: item.product.barcode, productName: item.product.name }
        : { clear: true };
      await fetch(`${esp32ServerUrl}/api/nutritrack/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (_e) {
      clearTimeout(timeoutId);
    }
  }, [esp32ServerUrl]);

  return (
    <NutriContext.Provider
      value={{
        profiles,
        currentProfile,
        products,
        inventory,
        consumptions,
        todayTotals,
        loading,
        esp32Connected,
        esp32ServerUrl,
        activeProductOnScale,
        setActiveProductOnScale,
        switchProfile,
        addProfile,
        updateProfile,
        addProduct,
        addToInventory,
        removeFromInventory,
        updateInventoryWeight,
        simulateReading,
        addConsumptionManual,
        deleteConsumption,
        syncEsp32,
      }}
    >
      {children}
    </NutriContext.Provider>
  );
}

export function useNutri() {
  const ctx = useContext(NutriContext);
  if (!ctx) throw new Error("useNutri must be used inside NutriProvider");
  return ctx;
}
