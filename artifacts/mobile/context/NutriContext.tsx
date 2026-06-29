import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ALL_CHILEAN_FOODS } from "../data/foods_chile";
import { useAuth } from "./AuthContext";

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
  sendWeighCommand: (action: "weigh" | "tare" | "stop") => Promise<void>;
  searchFatSecretFoods: (query: string, maxResults?: number) => Promise<FatSecretSearchResult>;
  importFromFatSecret: (foodId: string, foodName: string, brand?: string, caloriesPer100g?: number, proteinPer100g?: number, carbsPer100g?: number, fatPer100g?: number) => Promise<Product>;
  scaleToast: ScaleToast | null;
  clearScaleToast: () => void;
}

export interface ScaleToast {
  productName: string;
  weightConsumedG: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  weightBefore?: number;
  weightAfter?: number;
}

export interface FatSecretSearchResult {
  foods: Array<{
    id: string;
    name: string;
    brand?: string;
    description?: string;
    caloriesPer100g: number;
    proteinPer100g: number;
    carbsPer100g: number;
    fatPer100g: number;
  }>;
}

const NutriContext = createContext<NutriContextType | null>(null);

function storageKey(userId: string, base: string): string {
  return `nutritrack_${userId}_${base}`;
}

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

const SAMPLE_PRODUCTS: Product[] = ALL_CHILEAN_FOODS;

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

const round1 = (n: number) => Math.round(n * 10) / 10;

function uid() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function isSameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

// Derive per-100g values from a server consumption record
function serverConsumptionToProduct(sc: ServerConsumption): Product {
  const w = sc.weightConsumedG > 0 ? round1(sc.weightConsumedG) : 100;
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
  const { token, user } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [consumptions, setConsumptions] = useState<Consumption[]>([]);
  const [loading, setLoading] = useState(true);
  const [esp32Connected, setEsp32Connected] = useState(false);
  const [activeProductOnScale, setActiveProductOnScaleState] = useState<InventoryItem | null>(null);
  const [scaleToast, setScaleToast] = useState<ScaleToast | null>(null);

  function clearScaleToast() { setScaleToast(null); }

  // Use a ref so the polling closure never goes stale
  const lastSyncRef = useRef<string>(new Date(Date.now() - 60 * 1000).toISOString());
  const currentProfileIdRef = useRef<string | null>(null);
  currentProfileIdRef.current = currentProfileId;

  // Keep products accessible in async callbacks without stale closure
  const productsRef = useRef<Product[]>([]);
  productsRef.current = products;

  // Track whether we've synced products to the server in this session
  const productsSyncedRef = useRef(false);

  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  const userIdRef = useRef<string>("anon");
  userIdRef.current = user?.id || "anon";

  // ⚠️ Cambiar esta URL cada 60 min cuando expire el túnel Pinggy
  const esp32ServerUrl = "https://bqltc-201-188-79-192.run.pinggy-free.link";

  function K(base: string): string {
    return storageKey(userIdRef.current, base);
  }

  function authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (tokenRef.current) {
      headers["Authorization"] = `Bearer ${tokenRef.current}`;
    }
    return headers;
  }

  useEffect(() => {
    loadData();
  }, [user?.id]);

  async function loadData() {
    try {
      const [pStr, cpStr, prodStr, invStr, conStr] = await Promise.all([
        AsyncStorage.getItem(K("profiles")),
        AsyncStorage.getItem(K("currentProfileId")),
        AsyncStorage.getItem(K("products")),
        AsyncStorage.getItem(K("inventory")),
        AsyncStorage.getItem(K("consumptions")),
      ]);
      const loadedProfiles: Profile[] = pStr ? JSON.parse(pStr) : SAMPLE_PROFILES;
      let loadedProducts: Product[] = prodStr ? JSON.parse(prodStr) : SAMPLE_PRODUCTS;
      if (loadedProducts.length < ALL_CHILEAN_FOODS.length) {
        const existingIds = new Set(loadedProducts.map(p => p.id));
        const existingBarcodes = new Set(loadedProducts.map(p => p.barcode).filter(Boolean));
        const missing = ALL_CHILEAN_FOODS.filter(
          p => !existingIds.has(p.id) && !existingBarcodes.has(p.barcode),
        );
        if (missing.length > 0) {
          loadedProducts = [...loadedProducts, ...missing];
          await AsyncStorage.setItem(K("products"), JSON.stringify(loadedProducts));
        }
      }
      const loadedInventory: InventoryItem[] = invStr ? JSON.parse(invStr) : [];
      const loadedConsumptions: Consumption[] = conStr ? JSON.parse(conStr) : [];
      const loadedCurrentId: string | null = cpStr || loadedProfiles[0]?.id || null;

      if (!pStr) await AsyncStorage.setItem(K("profiles"), JSON.stringify(loadedProfiles));
      if (!prodStr) await AsyncStorage.setItem(K("products"), JSON.stringify(loadedProducts));
      if (!cpStr && loadedCurrentId) await AsyncStorage.setItem(K("currentProfileId"), loadedCurrentId);

      setProfiles(loadedProfiles);
      setCurrentProfileId(loadedCurrentId);
      setProducts(loadedProducts);
      setInventory(loadedInventory.map(i => ({
        ...i,
        currentWeightG: round1(i.currentWeightG),
        initialWeightG: round1(i.initialWeightG),
      })));
      setConsumptions(loadedConsumptions.map(c => ({
        ...c,
        weightConsumedG: round1(c.weightConsumedG),
      })));
    } catch (_e) {
    } finally {
      setLoading(false);
    }
  }

  function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
    return fetch(url, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers as Record<string, string> || {}) },
    });
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
          return apiFetch(`${esp32ServerUrl}/api/nutritrack/products`, {
            method: "POST",
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

// ─── ESP32 Status check (separado del sync de consumos) ──────────────────
  const checkEsp32Status = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await apiFetch(`${esp32ServerUrl}/api/nutritrack/status`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) { setEsp32Connected(false); return; }
      const data = await res.json();
      setEsp32Connected(data.esp32Connected === true);
    } catch {
      setEsp32Connected(false);
    }
  }, [esp32ServerUrl]);

// ─── ESP32 Polling ─────────────────────────────────────────────────────────
  const syncEsp32 = useCallback(async () => {
    const profileId = currentProfileIdRef.current;
    if (!profileId) return;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const since = encodeURIComponent(lastSyncRef.current);
      const res = await apiFetch(`${esp32ServerUrl}/api/nutritrack/consumptions?since=${since}`, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) { 
        productsSyncedRef.current = false; 
        return; 
      }

      // On first successful connect (or after reconnect), push local products
      if (!productsSyncedRef.current) {
        syncProductsToServer();
      }
      const data = await res.json();
      const serverList: ServerConsumption[] = data.consumptions ?? [];
      if (serverList.length === 0) return;

      // Build local consumption records from server data
      const toAdd: Consumption[] = serverList.map((sc) => ({
        id: "esp32-" + sc.id,
        profileId,
        product: serverConsumptionToProduct(sc),
        weightConsumedG: round1(sc.weightConsumedG),
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
        AsyncStorage.setItem(K("consumptions"), JSON.stringify(next));
        const first = fresh[0];
        const serverFirst = serverList.find((sc) => sc.id === first.id.replace("esp32-", ""));
        setScaleToast({
          productName: first.product.name,
          weightConsumedG: first.weightConsumedG,
          calories: first.calories,
          protein: first.protein,
          carbs: first.carbs,
          fat: first.fat,
          weightBefore: serverFirst?.weightBefore,
          weightAfter: serverFirst?.weightAfter,
        });
        return next;
      });

      // Update matching inventory items (by product name)
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
            currentWeightG: round1(Math.max(0, match.weightAfter)),
            initialWeightG: round1(Math.max(item.initialWeightG, match.weightBefore)),
            lastUpdated: match.timestamp,
            source: "esp32" as const,
          };
        });

        const existingNames = new Set(prev.map((i) => i.product.name.toLowerCase()));
        const newItems: InventoryItem[] = serverList
          .filter((sc) => !existingNames.has(sc.productName.toLowerCase()) && sc.weightAfter >= 0)
          .map((sc) => ({
            id: "esp32-inv-" + uid(),
            product: serverConsumptionToProduct(sc),
            currentWeightG: round1(Math.max(0, sc.weightAfter)),
            initialWeightG: round1(Math.max(0, sc.weightBefore)),
            lastUpdated: sc.timestamp,
            source: "esp32" as const,
          }));

        if (newItems.length > 0) changed = true;
        const next = [...updated, ...newItems];
        if (!changed) return prev;
        AsyncStorage.setItem(K("inventory"), JSON.stringify(next));
        return next;
      });

      lastSyncRef.current = new Date().toISOString();
    } catch (error) {
      productsSyncedRef.current = false;
      clearTimeout(timeoutId);
      console.error("Fallo catastrófico del fetch:", error);
    }
  }, [esp32ServerUrl])

  useEffect(() => {
    // Check ESP32 status frequently (cada 3s)
    const statusInterval = setInterval(() => checkEsp32Status(), 3000);
    // Sync consumos cada 5s
    const init = setTimeout(() => syncEsp32(), 2000);
    const syncInterval = setInterval(syncEsp32, 5000);
    return () => {
      clearTimeout(init);
      clearInterval(syncInterval);
      clearInterval(statusInterval);
    };
  }, [syncEsp32, checkEsp32Status]);

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
    await AsyncStorage.setItem(K("currentProfileId"), id);
  }, []);

  const addProfile = useCallback(async (p: Omit<Profile, "id">) => {
    const newProfile = { ...p, id: uid() };
    setProfiles((prev) => {
      const next = [...prev, newProfile];
      AsyncStorage.setItem(K("profiles"), JSON.stringify(next));
      return next;
    });
  }, []);

  const updateProfile = useCallback(async (p: Profile) => {
    setProfiles((prev) => {
      const next = prev.map((x) => (x.id === p.id ? p : x));
      AsyncStorage.setItem(K("profiles"), JSON.stringify(next));
      return next;
    });
  }, []);

  const addProduct = useCallback((p: Omit<Product, "id">): Product => {
    const newProduct = { ...p, id: uid() };
    setProducts((prev) => {
      const next = [...prev, newProduct];
      AsyncStorage.setItem(K("products"), JSON.stringify(next));
      return next;
    });
    return newProduct;
  }, []);

  const addToInventory = useCallback((product: Product, weightG: number): InventoryItem => {
    const item: InventoryItem = {
      id: uid(),
      product,
      currentWeightG: round1(weightG),
      initialWeightG: round1(weightG),
      lastUpdated: new Date().toISOString(),
      source: "manual",
    };
    setInventory((prev) => {
      const next = [...prev, item];
      AsyncStorage.setItem(K("inventory"), JSON.stringify(next));
      return next;
    });
    return item;
  }, []);

  const removeFromInventory = useCallback(async (itemId: string) => {
    setInventory((prev) => {
      const next = prev.filter((i) => i.id !== itemId);
      AsyncStorage.setItem(K("inventory"), JSON.stringify(next));
      return next;
    });
  }, []);

  const updateInventoryWeight = useCallback(
    (itemId: string, newWeightG: number, source: "esp32" | "manual" = "manual") => {
      setInventory((prev) => {
        const next = prev.map((i) =>
          i.id === itemId
            ? { ...i, currentWeightG: round1(Math.max(0, newWeightG)), lastUpdated: new Date().toISOString(), source }
            : i
        );
        AsyncStorage.setItem(K("inventory"), JSON.stringify(next));
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
        const delta = round1(item.currentWeightG - newWeightG);
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
          AsyncStorage.setItem(K("consumptions"), JSON.stringify(next));
          return next;
        });
        const updatedItem: InventoryItem = {
          ...item,
          currentWeightG: round1(newWeightG),
          lastUpdated: new Date().toISOString(),
        };
        const nextInv = prevInv.map((i) => (i.id === itemId ? updatedItem : i));
        AsyncStorage.setItem(K("inventory"), JSON.stringify(nextInv));
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
        weightConsumedG: round1(weightG),
        ...macros,
        timestamp: new Date().toISOString(),
        source: "manual",
      };
      setConsumptions((prev) => {
        const next = [consumption, ...prev];
        AsyncStorage.setItem(K("consumptions"), JSON.stringify(next));
        return next;
      });
    },
    [currentProfileId]
  );

  const deleteConsumption = useCallback(async (id: string) => {
    setConsumptions((prev) => {
      const next = prev.filter((c) => c.id !== id);
      AsyncStorage.setItem(K("consumptions"), JSON.stringify(next));
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
      await apiFetch(`${esp32ServerUrl}/api/nutritrack/active`, {
        method: "POST",
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (_e) {
      clearTimeout(timeoutId);
    }
  }, [esp32ServerUrl]);

  const sendWeighCommand = useCallback(async (action: "weigh" | "tare" | "stop") => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      await apiFetch(`${esp32ServerUrl}/api/nutritrack/weigh`, {
        method: "POST",
        body: JSON.stringify({ action }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (_e) {
      clearTimeout(timeoutId);
    }
  }, [esp32ServerUrl]);

  const searchFatSecretFoods = useCallback(async (query: string, maxResults = 20): Promise<FatSecretSearchResult> => {
    const res = await apiFetch(
      `${esp32ServerUrl}/api/fatsecret/search?q=${encodeURIComponent(query)}&max=${maxResults}`,
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`FatSecret search error: ${err}`);
    }
    return res.json();
  }, [esp32ServerUrl]);

  const importFromFatSecret = useCallback(async (
    foodId: string,
    foodName: string,
    brand?: string,
    caloriesPer100g = 0,
    proteinPer100g = 0,
    carbsPer100g = 0,
    fatPer100g = 0,
  ): Promise<Product> => {
    const newProduct: Product = {
      id: `fs-${foodId}`,
      barcode: undefined,
      name: foodName,
      brand,
      caloriesPer100g,
      proteinPer100g,
      carbsPer100g,
      fatPer100g,
    };
    setProducts((prev) => {
      const updated = [newProduct, ...prev];
      AsyncStorage.setItem(K("products"), JSON.stringify(updated));
      return updated;
    });
    return newProduct;
  }, []);

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
        sendWeighCommand,
        searchFatSecretFoods,
        importFromFatSecret,
        scaleToast,
        clearScaleToast,
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
