import { logger } from "./logger";

const TOKEN_URL = "https://oauth.fatsecret.com/connect/token";
const API_BASE = "https://platform.fatsecret.com/rest";

interface TokenCache {
  access_token: string;
  expires_at: number;
}

let tokenCache: TokenCache | null = null;

function getCredentials() {
  const clientId = process.env["FATSECRET_CLIENT_ID"];
  const clientSecret = process.env["FATSECRET_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error(
      "FATSECRET_CLIENT_ID and FATSECRET_CLIENT_SECRET must be set",
    );
  }
  return { clientId, clientSecret };
}

async function getToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expires_at) {
    return tokenCache.access_token;
  }

  const { clientId, clientSecret } = getCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=basic",
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, body: text }, "FatSecret token error");
    throw new Error(`FatSecret auth failed: ${res.status}`);
  }

  const data = await res.json();
  tokenCache = {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  };
  return data.access_token;
}

// ─── In-memory cache ────────────────────────────────────────────────

const cache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) {
    return entry.data as T;
  }
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown) {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
}

export function getCacheStats() {
  return { size: cache.size, keys: [...cache.keys()] };
}

// ─── API calls ──────────────────────────────────────────────────────

interface FatSecretFood {
  food_id: string;
  food_name: string;
  food_type?: string;
  brand?: string;
  food_description?: string;
}

interface FatSecretServing {
  serving_id: string;
  serving_description: string;
  metric_serving_amount?: string;
  metric_serving_unit?: string;
  calories?: string;
  protein?: string;
  carbohydrate?: string;
  fat?: string;
  fiber?: string;
  number_of_units?: string;
  measurement_description?: string;
}

export interface FatSecretFoodDetail {
  food_id: string;
  food_name: string;
  brand?: string;
  food_description?: string;
  food_url?: string;
  servings: FatSecretServing[];
}

export interface SearchResult {
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

async function apiFetch<T>(
  method: string,
  params: Record<string, string>,
): Promise<T> {
  const token = await getToken();
  const searchParams = new URLSearchParams({ method, ...params });

  const url = `${API_BASE}/server.api?${searchParams}`;
  const cacheKey = url;

  const cached = getCached<T>(cacheKey);
  if (cached) {
    logger.debug({ method, params }, "FatSecret cache hit");
    return cached;
  }

  logger.info({ method, params }, "FatSecret API call");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error({ status: res.status, body: text }, "FatSecret API error");
    throw new Error(`FatSecret API error: ${res.status}`);
  }

  const data = (await res.json()) as T;
  setCache(cacheKey, data);
  return data;
}

function parseNutrition(description?: string): {
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
} {
  const def = { caloriesPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 };
  if (!description) return def;

  const kcal = description.match(/Calories["\s:]+(\d+(?:\.\d+)?)/i);
  const protein = description.match(/Protein["\s:]+(\d+(?:\.\d+)?)/i);
  const carbs = description.match(/Carbs?["\s:]+(\d+(?:\.\d+)?)/i);
  const fat = description.match(/Fat["\s:]+(\d+(?:\.\d+)?)/i);

  return {
    caloriesPer100g: kcal ? Math.round(parseFloat(kcal[1])) : def.caloriesPer100g,
    proteinPer100g: protein ? Math.round(parseFloat(protein[1]) * 10) / 10 : def.proteinPer100g,
    carbsPer100g: carbs ? Math.round(parseFloat(carbs[1]) * 10) / 10 : def.carbsPer100g,
    fatPer100g: fat ? Math.round(parseFloat(fat[1]) * 10) / 10 : def.fatPer100g,
  };
}

export async function searchFoods(query: string, maxResults = 20): Promise<SearchResult> {
  interface RawResponse {
    foods?: {
      food?: Array<{
        food_id: string;
        food_name: string;
        food_type?: string;
        brand_name?: string;
        food_description?: string;
      }>;
      max_results?: string;
      total_results?: string;
    };
    error?: { code: number; message: string };
  }

  const raw = await apiFetch<RawResponse>("foods.search", {
    search_expression: query,
    max_results: String(maxResults),
    format: "json",
  });

  if (raw.error) {
    throw new Error(`FatSecret error ${raw.error.code}: ${raw.error.message}`);
  }

  const foodList = raw.foods?.food ?? [];
  return {
    foods: foodList.map((f) => {
      const nutr = parseNutrition(f.food_description);
      return {
        id: f.food_id,
        name: f.food_name,
        brand: f.brand_name,
        description: f.food_description,
        ...nutr,
      };
    }),
  };
}

export async function getFoodDetail(foodId: string): Promise<FatSecretFoodDetail | null> {
  interface RawResponse {
    food?: {
      food_id: string;
      food_name: string;
      brand_name?: string;
      food_description?: string;
      food_url?: string;
      servings?: {
        serving?: FatSecretServing | FatSecretServing[];
      };
    };
    error?: { code: number; message: string };
  }

  const raw = await apiFetch<RawResponse>("food.get.v4", {
    food_id: foodId,
    format: "json",
  });

  if (raw.error) {
    logger.warn({ foodId, error: raw.error }, "FatSecret food.get error");
    return null;
  }

  const f = raw.food;
  if (!f) return null;

  const servingsArr = f.servings?.serving
    ? Array.isArray(f.servings.serving)
      ? f.servings.serving
      : [f.servings.serving]
    : [];

  return {
    food_id: f.food_id,
    food_name: f.food_name,
    brand: f.brand_name,
    food_description: f.food_description,
    food_url: f.food_url,
    servings: servingsArr,
  };
}

export async function searchByBarcode(barcode: string): Promise<SearchResult> {
  interface RawResponse {
    foods?: {
      food?: Array<{
        food_id: string;
        food_name: string;
        brand_name?: string;
        food_description?: string;
      }>;
    };
    error?: { code: number; message: string };
  }

  const raw = await apiFetch<RawResponse>("food.find.barcodes", {
    barcode,
    format: "json",
  });

  if (raw.error) {
    return { foods: [] };
  }

  const foodList = raw.foods?.food ?? [];
  return {
    foods: foodList.map((f) => {
      const nutr = parseNutrition(f.food_description);
      return {
        id: f.food_id,
        name: f.food_name,
        brand: f.brand_name,
        description: f.food_description,
        ...nutr,
      };
    }),
  };
}
