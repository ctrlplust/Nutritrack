import { Router, type IRouter, type Request, type Response } from "express";
import { eq, sql, desc, gt, inArray } from "drizzle-orm";
import { db, productsTable, inventoryItemsTable, consumptionsTable } from "@workspace/db";
import { authenticate } from "../middleware/auth";

const router: IRouter = Router();

// ────────────────────────────────────────────────────────────────────────────
// Product types (API contract)
// ────────────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  barcode: string;
  name: string;
  brand?: string;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
}

interface InventoryItem {
  id: string;
  product: Product;
  currentWeightG: number;
  initialWeightG: number;
  lastUpdated: string;
  deviceId?: string;
}

interface Consumption {
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

// Active product: the product the user has placed (or will place) on the scale
let activeProduct: { barcode: string; name: string; setAt: string } | null = null;

// ESP32 connection tracking — updated every time /active is polled
let esp32LastSeen: number = 0;
const ESP32_TIMEOUT_MS = 15_000;

// SSE clients for real-time push to the mobile app
const sseClients = new Set<Response>();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function calcMacros(product: Product, weightG: number) {
  const f = weightG / 100;
  return {
    calories: Math.round(product.caloriesPer100g * f),
    protein: Math.round(product.proteinPer100g * f * 10) / 10,
    carbs: Math.round(product.carbsPer100g * f * 10) / 10,
    fat: Math.round(product.fatPer100g * f * 10) / 10,
  };
}

function sseEmit(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

async function findProductByBarcode(barcode: string): Promise<Product | undefined> {
  const rows = await db.select().from(productsTable).where(eq(productsTable.barcode, barcode)).limit(1);
  return rows[0] as Product | undefined;
}

async function findProductByName(name: string): Promise<Product | undefined> {
  const rows = await db.select().from(productsTable).where(eq(productsTable.name, name)).limit(1);
  return rows[0] as Product | undefined;
}

async function findInventoryItemByProductId(productId: string): Promise<InventoryItem | undefined> {
  const rows = await db.select({
    item: inventoryItemsTable,
    product: productsTable,
  })
    .from(inventoryItemsTable)
    .innerJoin(productsTable, eq(inventoryItemsTable.productId, productsTable.id))
    .where(eq(inventoryItemsTable.productId, productId))
    .limit(1);

  if (rows.length === 0) return undefined;
  const row = rows[0];
  return {
    id: row.item.id,
    product: row.product as Product,
    currentWeightG: row.item.currentWeightG,
    initialWeightG: row.item.initialWeightG,
    lastUpdated: row.item.lastUpdated?.toISOString() ?? new Date().toISOString(),
    deviceId: row.item.deviceId ?? undefined,
  };
}

async function getProductById(id: string): Promise<Product | undefined> {
  const rows = await db.select().from(productsTable).where(eq(productsTable.id, id)).limit(1);
  return rows[0] as Product | undefined;
}

// ────────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────────

function validateReading(body: unknown): {
  barcode?: string;
  productName?: string;
  weightG?: number;
  consumedG?: number;
  initialWeightG?: number;
  deviceId?: string;
} | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const hasBarcode = typeof b.barcode === "string" && b.barcode.trim() !== "";
  const hasName = typeof b.productName === "string" && b.productName.trim() !== "";
  const hasWeight = typeof b.weightG === "number" && (b.weightG as number) >= 0;
  const hasConsumed = typeof b.consumedG === "number" && (b.consumedG as number) > 0;
  if (!hasBarcode && !hasName && !activeProduct) return null;
  if (!hasWeight && !hasConsumed) return null;
  return {
    barcode: hasBarcode ? (b.barcode as string) : undefined,
    productName: hasName ? (b.productName as string) : undefined,
    weightG: hasWeight ? (b.weightG as number) : undefined,
    consumedG: hasConsumed ? (b.consumedG as number) : undefined,
    initialWeightG: typeof b.initialWeightG === "number" ? (b.initialWeightG as number) : undefined,
    deviceId: typeof b.deviceId === "string" ? b.deviceId : undefined,
  };
}

function validateProduct(body: unknown): Omit<Product, "id"> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.barcode !== "string" || !b.barcode) return null;
  if (typeof b.name !== "string" || !b.name) return null;
  return {
    barcode: b.barcode,
    name: b.name,
    brand: typeof b.brand === "string" ? b.brand : undefined,
    caloriesPer100g: Number(b.caloriesPer100g) || 0,
    proteinPer100g: Number(b.proteinPer100g) || 0,
    carbsPer100g: Number(b.carbsPer100g) || 0,
    fatPer100g: Number(b.fatPer100g) || 0,
  };
}

function validateInventory(body: unknown): { barcode: string; weightG: number; deviceId?: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.barcode !== "string" || !b.barcode) return null;
  if (typeof b.weightG !== "number" || b.weightG < 0) return null;
  return { barcode: b.barcode, weightG: b.weightG, deviceId: typeof b.deviceId === "string" ? b.deviceId : undefined };
}

// ────────────────────────────────────────────────────────────────────────────
// Seed products (fallback if DB is empty)
// ────────────────────────────────────────────────────────────────────────────

const seedProducts: Product[] = [
  { id: "meat-01", barcode: "7802800053001", name: "Pechuga de Pollo", brand: "Super Pollo", caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6 },
  { id: "meat-02", barcode: "7802800100001", name: "Pecho de Pavo", brand: "Sopraval", caloriesPer100g: 145, proteinPer100g: 28, carbsPer100g: 0.5, fatPer100g: 3 },
  { id: "meat-03", barcode: "7802800100002", name: "Carne Molida Vacuno", brand: "Carnes Ñuble", caloriesPer100g: 250, proteinPer100g: 17, carbsPer100g: 0, fatPer100g: 20 },
  { id: "meat-04", barcode: "7802800100003", name: "Lomo Liso Vacuno", brand: "Carnes Ñuble", caloriesPer100g: 200, proteinPer100g: 22, carbsPer100g: 0, fatPer100g: 12 },
  { id: "meat-05", barcode: "7802800100004", name: "Posta Rosada", brand: "Carnes Ñuble", caloriesPer100g: 160, proteinPer100g: 30, carbsPer100g: 0, fatPer100g: 4 },
  { id: "meat-06", barcode: "7802800100005", name: "Costillar de Cerdo", brand: "Carnes Ñuble", caloriesPer100g: 320, proteinPer100g: 16, carbsPer100g: 0, fatPer100g: 28 },
  { id: "meat-07", barcode: "7802800100006", name: "Lomo de Cerdo", brand: "Carnes Ñuble", caloriesPer100g: 242, proteinPer100g: 18, carbsPer100g: 0, fatPer100g: 19 },
  { id: "meat-08", barcode: "7802800100007", name: "Pulpa de Cordero", brand: "Carnes Ñuble", caloriesPer100g: 294, proteinPer100g: 15, carbsPer100g: 0, fatPer100g: 25 },
  { id: "meat-09", barcode: "7802800100008", name: "Hígado de Pollo", brand: "Super Pollo", caloriesPer100g: 119, proteinPer100g: 17, carbsPer100g: 2.5, fatPer100g: 4.8 },
  { id: "meat-10", barcode: "7802800100009", name: "Pana (Hígado) Vacuno", brand: "Carnes Ñuble", caloriesPer100g: 135, proteinPer100g: 20, carbsPer100g: 4, fatPer100g: 4 },
  { id: "emb-01", barcode: "7802800110001", name: "Vienesa Cerdo", brand: "San Jorge", caloriesPer100g: 270, proteinPer100g: 12, carbsPer100g: 3, fatPer100g: 23 },
  { id: "emb-02", barcode: "7802800110002", name: "Longaniza", brand: "San Jorge", caloriesPer100g: 290, proteinPer100g: 14, carbsPer100g: 2, fatPer100g: 25 },
  { id: "emb-03", barcode: "7802800110003", name: "Chorizo", brand: "San Jorge", caloriesPer100g: 310, proteinPer100g: 15, carbsPer100g: 2, fatPer100g: 27 },
  { id: "emb-04", barcode: "7802800110004", name: "Jamón de Pollo", brand: "San Jorge", caloriesPer100g: 120, proteinPer100g: 16, carbsPer100g: 3, fatPer100g: 5 },
  { id: "emb-05", barcode: "7802800110005", name: "Jamón Serrano", brand: "San Jorge", caloriesPer100g: 240, proteinPer100g: 18, carbsPer100g: 1, fatPer100g: 18 },
  { id: "emb-06", barcode: "7802800110006", name: "Paté de Cerdo", brand: "La Crianza", caloriesPer100g: 320, proteinPer100g: 13, carbsPer100g: 2, fatPer100g: 29 },
  { id: "emb-07", barcode: "7802800110007", name: "Mortadela", brand: "San Jorge", caloriesPer100g: 250, proteinPer100g: 11, carbsPer100g: 4, fatPer100g: 22 },
  { id: "emb-08", barcode: "7802800110008", name: "Salame", brand: "Salame Milano", caloriesPer100g: 350, proteinPer100g: 20, carbsPer100g: 2, fatPer100g: 29 },
  { id: "fish-01", barcode: "7802800033333", name: "Salmón Fresco", brand: "AquaChile", caloriesPer100g: 208, proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 13 },
  { id: "fish-02", barcode: "7802800120001", name: "Reineta", brand: "Pesca Chile", caloriesPer100g: 92, proteinPer100g: 19, carbsPer100g: 0, fatPer100g: 1.5 },
  { id: "fish-03", barcode: "7802800120002", name: "Congrio", brand: "Pesca Chile", caloriesPer100g: 82, proteinPer100g: 18, carbsPer100g: 0, fatPer100g: 0.8 },
  { id: "fish-04", barcode: "7802800120003", name: "Merluza", brand: "Pesca Chile", caloriesPer100g: 74, proteinPer100g: 17, carbsPer100g: 0, fatPer100g: 0.5 },
  { id: "fish-05", barcode: "7802800120004", name: "Albahacra", brand: "Pesca Chile", caloriesPer100g: 96, proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 1.2 },
  { id: "fish-06", barcode: "7802800120005", name: "Atún en Agua (lata)", brand: "San José", caloriesPer100g: 116, proteinPer100g: 26, carbsPer100g: 0, fatPer100g: 0.8 },
  { id: "fish-07", barcode: "7802800120006", name: "Sardinas (lata)", brand: "San José", caloriesPer100g: 208, proteinPer100g: 24, carbsPer100g: 0, fatPer100g: 12 },
  { id: "fish-08", barcode: "7802800120007", name: "Machas", brand: "Pesca Chile", caloriesPer100g: 78, proteinPer100g: 14, carbsPer100g: 3, fatPer100g: 0.8 },
  { id: "fish-09", barcode: "7802800120008", name: "Choritos", brand: "Pesca Chile", caloriesPer100g: 86, proteinPer100g: 12, carbsPer100g: 4, fatPer100g: 2 },
  { id: "fish-10", barcode: "7802800120009", name: "Ostiones", brand: "Pesca Chile", caloriesPer100g: 70, proteinPer100g: 10, carbsPer100g: 3, fatPer100g: 1.5 },
  { id: "fish-11", barcode: "7802800120010", name: "Loco", brand: "Pesca Chile", caloriesPer100g: 86, proteinPer100g: 17, carbsPer100g: 3, fatPer100g: 0.7 },
  { id: "fish-12", barcode: "7802800120011", name: "Camarón", brand: "Pesca Chile", caloriesPer100g: 84, proteinPer100g: 18, carbsPer100g: 0, fatPer100g: 0.9 },
  { id: "dairy-01", barcode: "7802800011111", name: "Huevo Entero", brand: "Sopraval", caloriesPer100g: 155, proteinPer100g: 13, carbsPer100g: 1.1, fatPer100g: 11 },
  { id: "dairy-02", barcode: "7802800130001", name: "Clara de Huevo", brand: "Sopraval", caloriesPer100g: 52, proteinPer100g: 11, carbsPer100g: 0.7, fatPer100g: 0.2 },
  { id: "dairy-03", barcode: "7802800130002", name: "Leche Entera", brand: "Colún", caloriesPer100g: 63, proteinPer100g: 3, carbsPer100g: 4.8, fatPer100g: 3.3 },
  { id: "dairy-04", barcode: "7802800130003", name: "Leche Descremada", brand: "Colún", caloriesPer100g: 35, proteinPer100g: 3.4, carbsPer100g: 4.8, fatPer100g: 0.1 },
  { id: "dairy-05", barcode: "7802800130004", name: "Leche Semi-descremada", brand: "Colún", caloriesPer100g: 48, proteinPer100g: 3.2, carbsPer100g: 4.8, fatPer100g: 1.5 },
  { id: "dairy-06", barcode: "7802800044444", name: "Yogurt Griego Natural", brand: "Nestlé", caloriesPer100g: 97, proteinPer100g: 9, carbsPer100g: 4, fatPer100g: 5 },
  { id: "dairy-07", barcode: "7802800130005", name: "Yogurt Bebible Frutilla", brand: "Colún", caloriesPer100g: 74, proteinPer100g: 2.8, carbsPer100g: 12, fatPer100g: 1.8 },
  { id: "dairy-08", barcode: "7802800130006", name: "Queso Gouda", brand: "Colún", caloriesPer100g: 356, proteinPer100g: 25, carbsPer100g: 0, fatPer100g: 28 },
  { id: "dairy-09", barcode: "7802800130007", name: "Queso Mantecoso", brand: "Colún", caloriesPer100g: 330, proteinPer100g: 22, carbsPer100g: 1, fatPer100g: 27 },
  { id: "dairy-10", barcode: "7802800130008", name: "Queso Fresco", brand: "Colún", caloriesPer100g: 230, proteinPer100g: 18, carbsPer100g: 2, fatPer100g: 17 },
  { id: "dairy-11", barcode: "7802800130009", name: "Queso Parmesano", brand: "Colún", caloriesPer100g: 392, proteinPer100g: 35, carbsPer100g: 3, fatPer100g: 27 },
  { id: "dairy-12", barcode: "7802800130010", name: "Mantequilla", brand: "Colún", caloriesPer100g: 716, proteinPer100g: 0.5, carbsPer100g: 0, fatPer100g: 81 },
  { id: "dairy-13", barcode: "7802800130011", name: "Crema (220g)", brand: "Colún", caloriesPer100g: 290, proteinPer100g: 2.5, carbsPer100g: 3, fatPer100g: 30 },
  { id: "dairy-14", barcode: "7802800130012", name: "Leche Condensada", brand: "Nestlé La Lechera", caloriesPer100g: 328, proteinPer100g: 8, carbsPer100g: 55, fatPer100g: 9 },
  { id: "grain-01", barcode: "7802800012345", name: "Arroz Integral", brand: "Carozzi", caloriesPer100g: 362, proteinPer100g: 7.5, carbsPer100g: 76, fatPer100g: 2.7 },
  { id: "grain-02", barcode: "7802800140001", name: "Arroz Grado 2", brand: "Carozzi", caloriesPer100g: 358, proteinPer100g: 6.5, carbsPer100g: 79, fatPer100g: 0.6 },
  { id: "grain-03", barcode: "7802800099001", name: "Avena Tradicional", brand: "Quaker", caloriesPer100g: 389, proteinPer100g: 17, carbsPer100g: 66, fatPer100g: 7 },
  { id: "grain-04", barcode: "7802800140002", name: "Pasta Spaghetti", brand: "Carozzi", caloriesPer100g: 355, proteinPer100g: 12, carbsPer100g: 73, fatPer100g: 1.5 },
  { id: "grain-05", barcode: "7802800140003", name: "Pasta Tallarines", brand: "Carozzi", caloriesPer100g: 355, proteinPer100g: 12, carbsPer100g: 73, fatPer100g: 1.5 },
  { id: "grain-06", barcode: "7802800140004", name: "Pasta Lasaña", brand: "Carozzi", caloriesPer100g: 355, proteinPer100g: 12, carbsPer100g: 73, fatPer100g: 1.5 },
  { id: "grain-07", barcode: "7802800140005", name: "Harina de Trigo", brand: "Carozzi", caloriesPer100g: 364, proteinPer100g: 10, carbsPer100g: 76, fatPer100g: 1 },
  { id: "grain-08", barcode: "7802800066666", name: "Quinoa", brand: "Granos del Sol", caloriesPer100g: 368, proteinPer100g: 14, carbsPer100g: 64, fatPer100g: 6 },
  { id: "grain-09", barcode: "7802800140006", name: "Couscous", brand: "Carozzi", caloriesPer100g: 356, proteinPer100g: 12, carbsPer100g: 72, fatPer100g: 0.6 },
  { id: "grain-10", barcode: "7802800140007", name: "Maíz Molido", brand: "Carozzi", caloriesPer100g: 365, proteinPer100g: 8, carbsPer100g: 76, fatPer100g: 3.5 },
  { id: "grain-11", barcode: "7802800140008", name: "Sémola", brand: "Carozzi", caloriesPer100g: 350, proteinPer100g: 10, carbsPer100g: 74, fatPer100g: 1 },
  { id: "grain-12", barcode: "7802800140009", name: "Granola Avena", brand: "Quaker", caloriesPer100g: 430, proteinPer100g: 10, carbsPer100g: 65, fatPer100g: 15 },
  { id: "leg-01", barcode: "7802800150001", name: "Porotos", brand: "Granos del Sol", caloriesPer100g: 347, proteinPer100g: 22, carbsPer100g: 61, fatPer100g: 1.5 },
  { id: "leg-02", barcode: "7802800150002", name: "Lentejas", brand: "Granos del Sol", caloriesPer100g: 352, proteinPer100g: 25, carbsPer100g: 60, fatPer100g: 1.1 },
  { id: "leg-03", barcode: "7802800150003", name: "Garbanzos", brand: "Granos del Sol", caloriesPer100g: 378, proteinPer100g: 20, carbsPer100g: 61, fatPer100g: 6 },
  { id: "leg-04", barcode: "7802800150004", name: "Arvejas Secas", brand: "Granos del Sol", caloriesPer100g: 339, proteinPer100g: 24, carbsPer100g: 60, fatPer100g: 1.4 },
  { id: "leg-05", barcode: "7802800150005", name: "Porotos Negros", brand: "Granos del Sol", caloriesPer100g: 339, proteinPer100g: 21, carbsPer100g: 62, fatPer100g: 1.4 },
  { id: "leg-06", barcode: "7802800150006", name: "Soja", brand: "Granos del Sol", caloriesPer100g: 416, proteinPer100g: 36, carbsPer100g: 30, fatPer100g: 20 },
  { id: "veg-01", barcode: "7802800160001", name: "Palta", brand: "Fresh", caloriesPer100g: 160, proteinPer100g: 2, carbsPer100g: 9, fatPer100g: 15 },
  { id: "veg-02", barcode: "7802800160002", name: "Tomate", brand: "Fresh", caloriesPer100g: 18, proteinPer100g: 0.9, carbsPer100g: 3.9, fatPer100g: 0.2 },
  { id: "veg-03", barcode: "7802800160003", name: "Cebolla", brand: "Fresh", caloriesPer100g: 40, proteinPer100g: 1.1, carbsPer100g: 9.3, fatPer100g: 0.1 },
  { id: "veg-04", barcode: "7802800160004", name: "Lechuga", brand: "Fresh", caloriesPer100g: 15, proteinPer100g: 1.4, carbsPer100g: 2.9, fatPer100g: 0.2 },
  { id: "veg-05", barcode: "7802800160005", name: "Zanahoria", brand: "Fresh", caloriesPer100g: 41, proteinPer100g: 0.9, carbsPer100g: 9.6, fatPer100g: 0.2 },
  { id: "veg-06", barcode: "7802800160006", name: "Papas", brand: "Fresh", caloriesPer100g: 77, proteinPer100g: 2, carbsPer100g: 18, fatPer100g: 0.1 },
  { id: "veg-07", barcode: "7802800160007", name: "Zapallo", brand: "Fresh", caloriesPer100g: 26, proteinPer100g: 1, carbsPer100g: 6, fatPer100g: 0.1 },
  { id: "veg-08", barcode: "7802800160008", name: "Brócoli", brand: "Fresh", caloriesPer100g: 34, proteinPer100g: 2.8, carbsPer100g: 7, fatPer100g: 0.4 },
  { id: "veg-09", barcode: "7802800160009", name: "Coliflor", brand: "Fresh", caloriesPer100g: 25, proteinPer100g: 1.9, carbsPer100g: 5, fatPer100g: 0.3 },
  { id: "veg-10", barcode: "7802800160010", name: "Repollo", brand: "Fresh", caloriesPer100g: 25, proteinPer100g: 1.3, carbsPer100g: 5.8, fatPer100g: 0.1 },
  { id: "veg-11", barcode: "7802800160011", name: "Espinaca", brand: "Fresh", caloriesPer100g: 23, proteinPer100g: 2.9, carbsPer100g: 3.6, fatPer100g: 0.4 },
  { id: "veg-12", barcode: "7802800160012", name: "Acelga", brand: "Fresh", caloriesPer100g: 19, proteinPer100g: 1.8, carbsPer100g: 3.7, fatPer100g: 0.2 },
  { id: "veg-13", barcode: "7802800160013", name: "Choclo", brand: "Fresh", caloriesPer100g: 96, proteinPer100g: 3.4, carbsPer100g: 21, fatPer100g: 1.5 },
  { id: "veg-14", barcode: "7802800160014", name: "Pimiento Rojo", brand: "Fresh", caloriesPer100g: 31, proteinPer100g: 1, carbsPer100g: 6, fatPer100g: 0.3 },
  { id: "veg-15", barcode: "7802800160015", name: "Pimiento Verde", brand: "Fresh", caloriesPer100g: 20, proteinPer100g: 0.9, carbsPer100g: 4.6, fatPer100g: 0.2 },
  { id: "veg-16", barcode: "7802800160016", name: "Ajo", brand: "Fresh", caloriesPer100g: 149, proteinPer100g: 6.4, carbsPer100g: 33, fatPer100g: 0.5 },
  { id: "veg-17", barcode: "7802800160017", name: "Pepino", brand: "Fresh", caloriesPer100g: 15, proteinPer100g: 0.7, carbsPer100g: 3.6, fatPer100g: 0.1 },
  { id: "veg-18", barcode: "7802800160018", name: "Porotos Verdes", brand: "Fresh", caloriesPer100g: 31, proteinPer100g: 1.8, carbsPer100g: 7, fatPer100g: 0.1 },
  { id: "veg-19", barcode: "7802800160019", name: "Betarraga", brand: "Fresh", caloriesPer100g: 43, proteinPer100g: 1.6, carbsPer100g: 9.6, fatPer100g: 0.2 },
  { id: "veg-20", barcode: "7802800160020", name: "Apio", brand: "Fresh", caloriesPer100g: 16, proteinPer100g: 0.7, carbsPer100g: 3.5, fatPer100g: 0.2 },
  { id: "veg-21", barcode: "7802800160021", name: "Espárragos", brand: "Fresh", caloriesPer100g: 20, proteinPer100g: 2.2, carbsPer100g: 3.9, fatPer100g: 0.1 },
  { id: "veg-22", barcode: "7802800160022", name: "Champiñones", brand: "Fresh", caloriesPer100g: 22, proteinPer100g: 3.1, carbsPer100g: 3.3, fatPer100g: 0.3 },
  { id: "fruit-01", barcode: "7802800170001", name: "Plátano", brand: "Fresh", caloriesPer100g: 89, proteinPer100g: 1.1, carbsPer100g: 23, fatPer100g: 0.3 },
  { id: "fruit-02", barcode: "7802800170002", name: "Manzana", brand: "Fresh", caloriesPer100g: 52, proteinPer100g: 0.3, carbsPer100g: 14, fatPer100g: 0.2 },
  { id: "fruit-03", barcode: "7802800170003", name: "Naranja", brand: "Fresh", caloriesPer100g: 47, proteinPer100g: 0.9, carbsPer100g: 12, fatPer100g: 0.1 },
  { id: "fruit-04", barcode: "7802800170004", name: "Limón", brand: "Fresh", caloriesPer100g: 29, proteinPer100g: 1.1, carbsPer100g: 9.3, fatPer100g: 0.3 },
  { id: "fruit-05", barcode: "7802800170005", name: "Uva", brand: "Fresh", caloriesPer100g: 69, proteinPer100g: 0.7, carbsPer100g: 18, fatPer100g: 0.2 },
  { id: "fruit-06", barcode: "7802800170006", name: "Frutilla", brand: "Fresh", caloriesPer100g: 32, proteinPer100g: 0.7, carbsPer100g: 7.7, fatPer100g: 0.3 },
  { id: "fruit-07", barcode: "7802800170007", name: "Sandía", brand: "Fresh", caloriesPer100g: 30, proteinPer100g: 0.6, carbsPer100g: 7.6, fatPer100g: 0.2 },
  { id: "fruit-08", barcode: "7802800170008", name: "Melón", brand: "Fresh", caloriesPer100g: 34, proteinPer100g: 0.8, carbsPer100g: 8.2, fatPer100g: 0.2 },
  { id: "fruit-09", barcode: "7802800170009", name: "Pera", brand: "Fresh", caloriesPer100g: 57, proteinPer100g: 0.4, carbsPer100g: 15, fatPer100g: 0.1 },
  { id: "fruit-10", barcode: "7802800170010", name: "Durazno", brand: "Fresh", caloriesPer100g: 39, proteinPer100g: 0.9, carbsPer100g: 9.5, fatPer100g: 0.3 },
  { id: "fruit-11", barcode: "7802800170011", name: "Mango", brand: "Fresh", caloriesPer100g: 60, proteinPer100g: 0.8, carbsPer100g: 15, fatPer100g: 0.4 },
  { id: "fruit-12", barcode: "7802800170012", name: "Piña", brand: "Fresh", caloriesPer100g: 50, proteinPer100g: 0.5, carbsPer100g: 13, fatPer100g: 0.1 },
  { id: "fruit-13", barcode: "7802800170013", name: "Palta (Aguacate)", brand: "Fresh", caloriesPer100g: 160, proteinPer100g: 2, carbsPer100g: 9, fatPer100g: 15 },
  { id: "fruit-14", barcode: "7802800170014", name: "Cerezas", brand: "Fresh", caloriesPer100g: 50, proteinPer100g: 1, carbsPer100g: 12, fatPer100g: 0.3 },
  { id: "fruit-15", barcode: "7802800170015", name: "Arándanos", brand: "Fresh", caloriesPer100g: 57, proteinPer100g: 0.7, carbsPer100g: 14, fatPer100g: 0.3 },
  { id: "fruit-16", barcode: "7802800170016", name: "Kiwi", brand: "Fresh", caloriesPer100g: 61, proteinPer100g: 1.1, carbsPer100g: 15, fatPer100g: 0.5 },
  { id: "fruit-17", barcode: "7802800170017", name: "Tuna", brand: "Fresh", caloriesPer100g: 41, proteinPer100g: 0.7, carbsPer100g: 10, fatPer100g: 0.1 },
  { id: "fruit-18", barcode: "7802800170018", name: "Higos Frescos", brand: "Fresh", caloriesPer100g: 74, proteinPer100g: 0.8, carbsPer100g: 19, fatPer100g: 0.3 },
  { id: "nut-01", barcode: "7802800077777", name: "Almendras", brand: "Planters", caloriesPer100g: 579, proteinPer100g: 21, carbsPer100g: 22, fatPer100g: 50 },
  { id: "nut-02", barcode: "7802800180001", name: "Nueces", brand: "Planters", caloriesPer100g: 654, proteinPer100g: 15, carbsPer100g: 14, fatPer100g: 65 },
  { id: "nut-03", barcode: "7802800180002", name: "Maní", brand: "Planters", caloriesPer100g: 567, proteinPer100g: 26, carbsPer100g: 16, fatPer100g: 49 },
  { id: "nut-04", barcode: "7802800180003", name: "Avellanas", brand: "Planters", caloriesPer100g: 628, proteinPer100g: 15, carbsPer100g: 17, fatPer100g: 61 },
  { id: "nut-05", barcode: "7802800180004", name: "Semillas de Chía", brand: "Granos del Sol", caloriesPer100g: 486, proteinPer100g: 17, carbsPer100g: 42, fatPer100g: 31 },
  { id: "nut-06", barcode: "7802800180005", name: "Semillas de Linaza", brand: "Granos del Sol", caloriesPer100g: 534, proteinPer100g: 18, carbsPer100g: 29, fatPer100g: 42 },
  { id: "nut-07", barcode: "7802800180006", name: "Semillas de Maravilla", brand: "Granos del Sol", caloriesPer100g: 584, proteinPer100g: 20, carbsPer100g: 20, fatPer100g: 51 },
  { id: "nut-08", barcode: "7802800180007", name: "Pasas", brand: "Granos del Sol", caloriesPer100g: 299, proteinPer100g: 3.1, carbsPer100g: 79, fatPer100g: 0.5 },
  { id: "nut-09", barcode: "7802800180008", name: "Ciruelas Pasas", brand: "Granos del Sol", caloriesPer100g: 240, proteinPer100g: 2.2, carbsPer100g: 64, fatPer100g: 0.4 },
  { id: "oil-01", barcode: "7802800055555", name: "Aceite de Oliva", brand: "Borges", caloriesPer100g: 884, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 100 },
  { id: "oil-02", barcode: "7802800190001", name: "Aceite Vegetal Maravilla", brand: "Natura", caloriesPer100g: 884, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 100 },
  { id: "oil-03", barcode: "7802800190002", name: "Aceite de Canola", brand: "Natura", caloriesPer100g: 884, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 100 },
  { id: "oil-04", barcode: "7802800190003", name: "Mayonesa", brand: "Hellmanns", caloriesPer100g: 722, proteinPer100g: 1.5, carbsPer100g: 0.5, fatPer100g: 79 },
  { id: "oil-05", barcode: "7802800190004", name: "Margarina", brand: "Dorina", caloriesPer100g: 716, proteinPer100g: 0.5, carbsPer100g: 0, fatPer100g: 80 },
  { id: "bread-01", barcode: "7802800200001", name: "Pan Marraqueta", brand: "Panadería", caloriesPer100g: 265, proteinPer100g: 8.5, carbsPer100g: 52, fatPer100g: 2.5 },
  { id: "bread-02", barcode: "7802800200002", name: "Pan Hallulla", brand: "Panadería", caloriesPer100g: 290, proteinPer100g: 8, carbsPer100g: 55, fatPer100g: 3.5 },
  { id: "bread-03", barcode: "7802800200003", name: "Pan de Molde Blanco", brand: "Bimbo", caloriesPer100g: 250, proteinPer100g: 8, carbsPer100g: 46, fatPer100g: 3 },
  { id: "bread-04", barcode: "7802800200004", name: "Pan de Molde Integral", brand: "Bimbo", caloriesPer100g: 230, proteinPer100g: 9, carbsPer100g: 42, fatPer100g: 3.2 },
  { id: "bread-05", barcode: "7802800200005", name: "Pan de Pita", brand: "Bimbo", caloriesPer100g: 275, proteinPer100g: 9, carbsPer100g: 56, fatPer100g: 1.5 },
  { id: "bread-06", barcode: "7802800200006", name: "Pan de Centeno", brand: "Panadería", caloriesPer100g: 230, proteinPer100g: 8.5, carbsPer100g: 44, fatPer100g: 2.5 },
  { id: "bread-07", barcode: "7802800200007", name: "Galletas de Agua", brand: "Costa", caloriesPer100g: 434, proteinPer100g: 10, carbsPer100g: 72, fatPer100g: 12 },
  { id: "bread-08", barcode: "7802800200008", name: "Galletas Integrales", brand: "Costa", caloriesPer100g: 410, proteinPer100g: 9, carbsPer100g: 67, fatPer100g: 13 },
  { id: "bread-09", barcode: "7802800200009", name: "Tostadas Integrales", brand: "Costa", caloriesPer100g: 368, proteinPer100g: 12, carbsPer100g: 64, fatPer100g: 5 },
  { id: "bread-10", barcode: "7802800200010", name: "Pan Arabe", brand: "Bimbo", caloriesPer100g: 260, proteinPer100g: 8, carbsPer100g: 52, fatPer100g: 2 },
  { id: "bev-01", barcode: "7802800210001", name: "Coca-Cola (lata)", brand: "Coca-Cola", caloriesPer100g: 42, proteinPer100g: 0, carbsPer100g: 10.6, fatPer100g: 0 },
  { id: "bev-02", barcode: "7802800210002", name: "Coca-Cola Zero", brand: "Coca-Cola", caloriesPer100g: 0.3, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 },
  { id: "bev-03", barcode: "7802800210003", name: "Sprite", brand: "Coca-Cola", caloriesPer100g: 41, proteinPer100g: 0, carbsPer100g: 10.2, fatPer100g: 0 },
  { id: "bev-04", barcode: "7802800210004", name: "Jugo Naranja Natural", brand: "Fresh", caloriesPer100g: 45, proteinPer100g: 0.7, carbsPer100g: 10.4, fatPer100g: 0.1 },
  { id: "bev-05", barcode: "7802800210005", name: "Néctar de Durazno", brand: "Watts", caloriesPer100g: 48, proteinPer100g: 0.1, carbsPer100g: 11.5, fatPer100g: 0 },
  { id: "bev-06", barcode: "7802800210006", name: "Agua Mineral CCU", brand: "CCU", caloriesPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 },
  { id: "bev-07", barcode: "7802800210007", name: "Cerveza Cristal", brand: "CCU", caloriesPer100g: 42, proteinPer100g: 0.3, carbsPer100g: 3.6, fatPer100g: 0 },
  { id: "bev-08", barcode: "7802800210008", name: "Cerveza Escudo", brand: "CCU", caloriesPer100g: 42, proteinPer100g: 0.3, carbsPer100g: 3.6, fatPer100g: 0 },
  { id: "bev-09", barcode: "7802800210009", name: "Vino Tinto", brand: "Concha y Toro", caloriesPer100g: 85, proteinPer100g: 0.1, carbsPer100g: 2.6, fatPer100g: 0 },
  { id: "bev-10", barcode: "7802800210010", name: "Vino Blanco", brand: "Concha y Toro", caloriesPer100g: 82, proteinPer100g: 0.1, carbsPer100g: 2.6, fatPer100g: 0 },
  { id: "cond-01", barcode: "7802800220001", name: "Salsa de Tomate", brand: "Malloa", caloriesPer100g: 86, proteinPer100g: 1.5, carbsPer100g: 19, fatPer100g: 0.4 },
  { id: "cond-02", barcode: "7802800220002", name: "Ketchup", brand: "Malloa", caloriesPer100g: 110, proteinPer100g: 1, carbsPer100g: 26, fatPer100g: 0.2 },
  { id: "cond-03", barcode: "7802800220003", name: "Mostaza", brand: "Malloa", caloriesPer100g: 66, proteinPer100g: 4.5, carbsPer100g: 6, fatPer100g: 3.5 },
  { id: "cond-04", barcode: "7802800220004", name: "Miel de Abeja", brand: "Apícola", caloriesPer100g: 304, proteinPer100g: 0.3, carbsPer100g: 82, fatPer100g: 0 },
  { id: "cond-05", barcode: "7802800220005", name: "Mermelada Frutilla", brand: "Elige", caloriesPer100g: 250, proteinPer100g: 0.3, carbsPer100g: 62, fatPer100g: 0.1 },
  { id: "cond-06", barcode: "7802800220006", name: "Dulce de Membrillo", brand: "Elige", caloriesPer100g: 220, proteinPer100g: 0.4, carbsPer100g: 54, fatPer100g: 0.1 },
  { id: "cond-07", barcode: "7802800220007", name: "Manjar", brand: "Colún", caloriesPer100g: 310, proteinPer100g: 7.5, carbsPer100g: 58, fatPer100g: 6 },
  { id: "cond-08", barcode: "7802800220008", name: "Sal", brand: "Lobos", caloriesPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 },
  { id: "cond-09", barcode: "7802800220009", name: "Azúcar Blanca", brand: "Iansa", caloriesPer100g: 387, proteinPer100g: 0, carbsPer100g: 100, fatPer100g: 0 },
  { id: "cond-10", barcode: "7802800220010", name: "Tomate Pelado (lata)", brand: "Malloa", caloriesPer100g: 20, proteinPer100g: 0.9, carbsPer100g: 4.3, fatPer100g: 0.2 },
  { id: "cond-11", barcode: "7802800220011", name: "Conserva de Choclo", brand: "Malloa", caloriesPer100g: 85, proteinPer100g: 2.5, carbsPer100g: 19, fatPer100g: 0.5 },
  { id: "cond-12", barcode: "7802800220012", name: "Aceitunas Verdes", brand: "Cuccina", caloriesPer100g: 145, proteinPer100g: 1, carbsPer100g: 1, fatPer100g: 15 },
  { id: "dish-01", barcode: "7802800230001", name: "Porotos con Riendas", brand: "Caserito", caloriesPer100g: 130, proteinPer100g: 7, carbsPer100g: 20, fatPer100g: 2 },
  { id: "dish-02", barcode: "7802800230002", name: "Cazuela de Vacuno", brand: "Caserito", caloriesPer100g: 68, proteinPer100g: 6, carbsPer100g: 6, fatPer100g: 2 },
  { id: "dish-03", barcode: "7802800230003", name: "Cazuela de Pollo", brand: "Caserito", caloriesPer100g: 56, proteinPer100g: 5, carbsPer100g: 5, fatPer100g: 1.5 },
  { id: "dish-04", barcode: "7802800230004", name: "Humitas", brand: "Caserito", caloriesPer100g: 180, proteinPer100g: 5, carbsPer100g: 28, fatPer100g: 6 },
  { id: "dish-05", barcode: "7802800230005", name: "Pastel de Choclo", brand: "Caserito", caloriesPer100g: 150, proteinPer100g: 6, carbsPer100g: 18, fatPer100g: 6 },
  { id: "dish-06", barcode: "7802800230006", name: "Empanada de Pino", brand: "Caserito", caloriesPer100g: 250, proteinPer100g: 10, carbsPer100g: 28, fatPer100g: 11 },
  { id: "dish-07", barcode: "7802800230007", name: "Empanada de Queso", brand: "Caserito", caloriesPer100g: 300, proteinPer100g: 10, carbsPer100g: 27, fatPer100g: 17 },
  { id: "dish-08", barcode: "7802800230008", name: "Completo", brand: "Caserito", caloriesPer100g: 220, proteinPer100g: 8, carbsPer100g: 22, fatPer100g: 11 },
  { id: "dish-09", barcode: "7802800230009", name: "Charquicán", brand: "Caserito", caloriesPer100g: 95, proteinPer100g: 6, carbsPer100g: 13, fatPer100g: 2 },
  { id: "dish-10", barcode: "7802800230010", name: "Lentejas con Arroz", brand: "Caserito", caloriesPer100g: 140, proteinPer100g: 8, carbsPer100g: 23, fatPer100g: 1.5 },
  { id: "dish-11", barcode: "7802800230011", name: "Carbonada", brand: "Caserito", caloriesPer100g: 65, proteinPer100g: 5, carbsPer100g: 8, fatPer100g: 1.5 },
  { id: "dish-12", barcode: "7802800230012", name: "Paila Marina", brand: "Caserito", caloriesPer100g: 45, proteinPer100g: 6, carbsPer100g: 3, fatPer100g: 0.8 },
  { id: "snack-01", barcode: "7802800240001", name: "Papas Fritas (bolsa)", brand: "Evercrisp", caloriesPer100g: 540, proteinPer100g: 5, carbsPer100g: 53, fatPer100g: 34 },
  { id: "snack-02", barcode: "7802800240002", name: "Chocolate de Leche", brand: "Costa", caloriesPer100g: 541, proteinPer100g: 7, carbsPer100g: 59, fatPer100g: 30 },
  { id: "snack-03", barcode: "7802800240003", name: "Chocolate Negro 70%", brand: "Costa", caloriesPer100g: 600, proteinPer100g: 8, carbsPer100g: 45, fatPer100g: 43 },
  { id: "snack-04", barcode: "7802800240004", name: "Barra de Cereal", brand: "Quaker", caloriesPer100g: 410, proteinPer100g: 6, carbsPer100g: 70, fatPer100g: 12 },
  { id: "snack-05", barcode: "7802800240005", name: "Helado de Vainilla", brand: "Calo", caloriesPer100g: 200, proteinPer100g: 3.5, carbsPer100g: 24, fatPer100g: 11 },
  { id: "snack-06", barcode: "7802800240006", name: "Helado de Chocolate", brand: "Calo", caloriesPer100g: 215, proteinPer100g: 4, carbsPer100g: 25, fatPer100g: 12 },
  { id: "snack-07", barcode: "7802800240007", name: "Flan Vainilla", brand: "Calo", caloriesPer100g: 125, proteinPer100g: 4, carbsPer100g: 20, fatPer100g: 3.5 },
  { id: "snack-08", barcode: "7802800240008", name: "Jalea Cero Azúcar", brand: "Calo", caloriesPer100g: 20, proteinPer100g: 1.5, carbsPer100g: 0.5, fatPer100g: 0 },
  { id: "snack-09", barcode: "7802800240009", name: "Arroz con Leche", brand: "Calo", caloriesPer100g: 120, proteinPer100g: 3, carbsPer100g: 20, fatPer100g: 3 },
  { id: "supp-01", barcode: "7802800022222", name: "Whey Protein Chocolate", brand: "Optimum Nutrition", caloriesPer100g: 380, proteinPer100g: 75, carbsPer100g: 8, fatPer100g: 5 },
  { id: "supp-02", barcode: "7802800250001", name: "Whey Protein Vainilla", brand: "Optimum Nutrition", caloriesPer100g: 380, proteinPer100g: 75, carbsPer100g: 8, fatPer100g: 5 },
  { id: "supp-03", barcode: "7802800250002", name: "Proteína Vegetal (polvo)", brand: "VegetalPro", caloriesPer100g: 365, proteinPer100g: 70, carbsPer100g: 10, fatPer100g: 5 },
  { id: "supp-04", barcode: "7802800250003", name: "Creatina Monohidrato", brand: "Optimum Nutrition", caloriesPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 },
  { id: "supp-05", barcode: "7802800250004", name: "Barras Proteicas Chocolate", brand: "Fitbar", caloriesPer100g: 350, proteinPer100g: 30, carbsPer100g: 40, fatPer100g: 8 },
];

// ────────────────────────────────────────────────────────────────────────────
// Auto-seed on startup if DB is empty
// ────────────────────────────────────────────────────────────────────────────

(async function autoSeed() {
  try {
    const rows = await db.select({ count: sql<number>`count(*)::int` }).from(productsTable);
    if (rows[0].count === 0) {
      await db.insert(productsTable).values(seedProducts);
      console.log(`Seeded ${seedProducts.length} products into database`);
    }
  } catch {
    // DB not available — will fail at request time
    console.warn("Could not seed products — database unavailable");
  }
})();

// ────────────────────────────────────────────────────────────────────────────
// GET /api/nutritrack/status
// ────────────────────────────────────────────────────────────────────────────
router.get("/nutritrack/status", async (req, res) => {
  try {
    const [pCount, iCount, cCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(productsTable),
      db.select({ count: sql<number>`count(*)::int` }).from(inventoryItemsTable),
      db.select({ count: sql<number>`count(*)::int` }).from(consumptionsTable),
    ]);
    const now = Date.now();
    const esp32Connected = esp32LastSeen > 0 && (now - esp32LastSeen) < ESP32_TIMEOUT_MS;
    res.json({
      status: "online",
      version: "2.0.0",
      products: pCount[0].count,
      inventoryItems: iCount[0].count,
      totalConsumptions: cCount[0].count,
      activeProduct,
      esp32Connected,
      esp32LastSeen: esp32LastSeen > 0 ? new Date(esp32LastSeen).toISOString() : null,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Status endpoint DB error");
    res.status(500).json({ error: "Database unavailable" });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/nutritrack/events  — SSE stream for real-time mobile push
// ────────────────────────────────────────────────────────────────────────────
router.get("/nutritrack/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ activeProduct, timestamp: new Date().toISOString() })}\n\n`);

  const heartbeat = setInterval(() => {
    try { res.write(`:heartbeat\n\n`); } catch { /* ignore */ }
  }, 15000);

  sseClients.add(res);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/nutritrack/active  — Producto actualmente en balanza
// ────────────────────────────────────────────────────────────────────────────
router.get("/nutritrack/active", (_req, res) => {
  esp32LastSeen = Date.now();
  res.json({ activeProduct });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/nutritrack/active  — App avisa qué producto se pone en la balanza
// ────────────────────────────────────────────────────────────────────────────
router.post("/nutritrack/active", async (req, res) => {
  const b = req.body as Record<string, unknown>;
  const barcode = typeof b.barcode === "string" ? b.barcode.trim() : null;
  const productName = typeof b.productName === "string" ? b.productName.trim() : null;
  const clear = b.clear === true || (!barcode && !productName);

  if (clear) {
    req.log.info("Producto activo removido");
    res.json({ message: "Producto activo removido", activeProduct: null });
    return;
  }

  let product: Product | undefined;
  if (barcode) {
    product = await findProductByBarcode(barcode);
  } else if (productName) {
    product = await findProductByName(productName);
  }

  if (!product) {
    res.status(404).json({ error: "Producto no encontrado", barcode, productName });
    return;
  }

  activeProduct = { barcode: product.barcode, name: product.name, setAt: new Date().toISOString() };
  sseEmit("active_changed", { activeProduct, product });
  req.log.info({ productName: product.name }, "Producto activo en balanza");
  res.json({ message: `Producto activo: ${product.name}`, activeProduct, product });
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/nutritrack/products
// ────────────────────────────────────────────────────────────────────────────
router.get("/nutritrack/products", async (_req, res) => {
  try {
    const products = await db.select().from(productsTable);
    res.json({ products });
  } catch (err) {
    res.status(500).json({ error: "Database unavailable" });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/nutritrack/products
// ────────────────────────────────────────────────────────────────────────────
router.post("/nutritrack/products", async (req, res) => {
  const parsed = validateProduct(req.body);
  if (!parsed) {
    res.status(400).json({ error: "Datos inválidos. Se requiere barcode y name." });
    return;
  }

  try {
    const existing = await db.select().from(productsTable)
      .where(eq(productsTable.barcode, parsed.barcode))
      .limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "Producto ya registrado con ese código" });
      return;
    }

    const product: Product = { id: uid(), ...parsed };
    await db.insert(productsTable).values(product);
    req.log.info({ barcode: product.barcode, name: product.name }, "Producto registrado");
    res.status(201).json({ product });
  } catch (err) {
    req.log.error({ err }, "Error registrando producto");
    res.status(500).json({ error: "Error al registrar producto" });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/nutritrack/inventory
// ────────────────────────────────────────────────────────────────────────────
router.get("/nutritrack/inventory", async (_req, res) => {
  try {
    const rows = await db.select({
      item: inventoryItemsTable,
      product: productsTable,
    })
      .from(inventoryItemsTable)
      .innerJoin(productsTable, eq(inventoryItemsTable.productId, productsTable.id))
      .orderBy(inventoryItemsTable.lastUpdated);

    const inventory: InventoryItem[] = rows.map((r: { item: typeof inventoryItemsTable.$inferSelect; product: typeof productsTable.$inferSelect }) => ({
      id: r.item.id,
      product: r.product as Product,
      currentWeightG: r.item.currentWeightG,
      initialWeightG: r.item.initialWeightG,
      lastUpdated: r.item.lastUpdated?.toISOString() ?? new Date().toISOString(),
      deviceId: r.item.deviceId ?? undefined,
    }));

    res.json({ inventory });
  } catch (err) {
    res.status(500).json({ error: "Database unavailable" });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/nutritrack/inventory
// ────────────────────────────────────────────────────────────────────────────
router.post("/nutritrack/inventory", async (req, res) => {
  const parsed = validateInventory(req.body);
  if (!parsed) {
    res.status(400).json({ error: "Datos inválidos. Se requiere barcode (string) y weightG (number)." });
    return;
  }

  try {
    const product = await findProductByBarcode(parsed.barcode);
    if (!product) {
      res.status(404).json({ error: "Producto no encontrado. Registra el producto primero.", barcode: parsed.barcode });
      return;
    }

    const existing = await findInventoryItemByProductId(product.id);
    if (existing) {
      await db.update(inventoryItemsTable)
        .set({ currentWeightG: parsed.weightG, lastUpdated: new Date() })
        .where(eq(inventoryItemsTable.productId, product.id));

      const updated: InventoryItem = {
        ...existing,
        currentWeightG: parsed.weightG,
        lastUpdated: new Date().toISOString(),
      };
      req.log.info({ barcode: parsed.barcode, weightG: parsed.weightG }, "Peso actualizado en inventario");
      res.json({ item: updated, updated: true });
      return;
    }

    const item: InventoryItem = {
      id: uid(),
      product,
      currentWeightG: parsed.weightG,
      initialWeightG: parsed.weightG,
      lastUpdated: new Date().toISOString(),
      deviceId: parsed.deviceId,
    };
    await db.insert(inventoryItemsTable).values({
      id: item.id,
      productId: product.id,
      currentWeightG: item.currentWeightG,
      initialWeightG: item.initialWeightG,
      lastUpdated: new Date(),
      deviceId: item.deviceId ?? null,
    });

    req.log.info({ barcode: parsed.barcode, weightG: parsed.weightG }, "Producto agregado al inventario");
    res.status(201).json({ item, updated: false });
  } catch (err) {
    req.log.error({ err }, "Error actualizando inventario");
    res.status(500).json({ error: "Error al actualizar inventario" });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/nutritrack/reading  — ENDPOINT PRINCIPAL DEL ESP32
// ────────────────────────────────────────────────────────────────────────────
router.post("/nutritrack/reading", async (req, res) => {
  const parsed = validateReading(req.body);
  if (!parsed) {
    res.status(400).json({ error: "Payload inválido. Se requiere (barcode o productName) + (weightG o consumedG)." });
    return;
  }

  try {
    let { barcode, productName } = parsed;
    if (!barcode && !productName && activeProduct) {
      barcode = activeProduct.barcode;
    }

    const { weightG, consumedG, initialWeightG, deviceId } = parsed;

    let product = barcode
      ? await findProductByBarcode(barcode)
      : productName
        ? await findProductByName(productName)
        : undefined;

    // Auto-create product if not found but name provided
    if (!product && productName && !barcode) {
      const autoBarcode = "auto-" + productName.toLowerCase().replace(/\s+/g, "-");
      const autoProduct: Product = {
        id: uid(),
        barcode: autoBarcode,
        name: productName,
        caloriesPer100g: 0,
        proteinPer100g: 0,
        carbsPer100g: 0,
        fatPer100g: 0,
      };
      await db.insert(productsTable).values(autoProduct);
      product = autoProduct;

      const pesoFinal = weightG ?? 0;
      const pesoInicial = initialWeightG ?? (pesoFinal + (consumedG ?? 0));

      const newItemId = uid();
      await db.insert(inventoryItemsTable).values({
        id: newItemId,
        productId: autoProduct.id,
        currentWeightG: Math.max(0, pesoFinal),
        initialWeightG: pesoInicial,
        lastUpdated: new Date(),
        deviceId: deviceId ?? null,
      });

      const newItem: InventoryItem = {
        id: newItemId,
        product: autoProduct,
        currentWeightG: Math.max(0, pesoFinal),
        initialWeightG: pesoInicial,
        lastUpdated: new Date().toISOString(),
        deviceId,
      };

      if (consumedG !== undefined && consumedG > 0) {
        const consumptionId = uid();
        await db.insert(consumptionsTable).values({
          id: consumptionId,
          productId: autoProduct.id,
          productName: autoProduct.name,
          weightConsumedG: consumedG,
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          weightBefore: pesoInicial,
          weightAfter: Math.max(0, pesoFinal),
          deviceId: deviceId ?? null,
          timestamp: new Date(),
        });

        const consumption: Consumption = {
          id: consumptionId,
          productId: autoProduct.id,
          productName: autoProduct.name,
          weightConsumedG: consumedG,
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          weightBefore: pesoInicial,
          weightAfter: Math.max(0, pesoFinal),
          deviceId,
          timestamp: new Date().toISOString(),
        };

        sseEmit("consumption", { consumption, item: newItem, activeProduct });
        req.log.info({ productName, consumedG }, "Consumo de producto nuevo registrado (macros pendientes)");
        res.status(201).json({
          action: "consumption_recorded",
          message: `Consumo de ${consumedG}g de "${productName}" registrado. Sincroniza la app para ver las macros.`,
          consumption,
          item: newItem,
        });
      } else {
        sseEmit("inventory_created", { item: newItem, activeProduct });
        res.status(201).json({
          action: "inventory_created",
          message: `Producto "${productName}" registrado automáticamente.`,
          item: newItem,
          delta: null,
        });
      }
      return;
    }

    if (!product) {
      res.status(404).json({ error: "Producto no encontrado y no hay producto activo.", barcode, productName });
      return;
    }

    let item = await findInventoryItemByProductId(product.id);

    // ── RAMA A: ESP32 FSM ya calculó el delta ──────────────────────────────────
    if (consumedG !== undefined && consumedG > 0) {
      const pesoFinal = weightG ?? (item ? item.currentWeightG - consumedG : 0);
      const pesoInicial = initialWeightG ?? (item ? item.currentWeightG : pesoFinal + consumedG);

      if (!item) {
        const newItemId = uid();
        await db.insert(inventoryItemsTable).values({
          id: newItemId,
          productId: product.id,
          currentWeightG: Math.max(0, pesoFinal),
          initialWeightG: pesoInicial,
          lastUpdated: new Date(),
          deviceId: deviceId ?? null,
        });
        item = {
          id: newItemId,
          product,
          currentWeightG: Math.max(0, pesoFinal),
          initialWeightG: pesoInicial,
          lastUpdated: new Date().toISOString(),
          deviceId,
        };
      } else {
        await db.update(inventoryItemsTable)
          .set({ currentWeightG: Math.max(0, pesoFinal), lastUpdated: new Date() })
          .where(eq(inventoryItemsTable.id, item.id));
        item.currentWeightG = Math.max(0, pesoFinal);
        item.lastUpdated = new Date().toISOString();
      }

      const macros = calcMacros(product, consumedG);
      const consumptionId = uid();
      await db.insert(consumptionsTable).values({
        id: consumptionId,
        productId: product.id,
        productName: product.name,
        weightConsumedG: consumedG,
        ...macros,
        weightBefore: pesoInicial,
        weightAfter: Math.max(0, pesoFinal),
        deviceId: deviceId ?? null,
        timestamp: new Date(),
      });

      const consumption: Consumption = {
        id: consumptionId,
        productId: product.id,
        productName: product.name,
        weightConsumedG: consumedG,
        ...macros,
        weightBefore: pesoInicial,
        weightAfter: Math.max(0, pesoFinal),
        deviceId,
        timestamp: new Date().toISOString(),
      };

      req.log.info({ productName: product.name, consumedG, calories: macros.calories }, "Consumo ESP32-FSM registrado");
      sseEmit("consumption", { consumption, item, activeProduct });

      res.status(201).json({
        action: "consumption_recorded",
        message: `Consumo registrado: Δ ${consumedG}g de ${product.name}`,
        consumption,
        item,
      });
      return;
    }

    // ── RAMA B: ESP32 envía peso actual, servidor calcula delta ────────────────
    if (weightG === undefined) {
      res.status(400).json({ error: "Se requiere weightG o consumedG." });
      return;
    }

    if (!item) {
      const newItemId = uid();
      await db.insert(inventoryItemsTable).values({
        id: newItemId,
        productId: product.id,
        currentWeightG: weightG,
        initialWeightG: weightG,
        lastUpdated: new Date(),
        deviceId: deviceId ?? null,
      });
      item = {
        id: newItemId,
        product,
        currentWeightG: weightG,
        initialWeightG: weightG,
        lastUpdated: new Date().toISOString(),
        deviceId,
      };
      req.log.info({ productName: product.name, weightG }, "Primera lectura — inventario creado");
      sseEmit("inventory_created", { item, activeProduct });
      res.status(201).json({ action: "inventory_created", message: "Primer registro.", item, delta: null });
      return;
    }

    const delta = item.currentWeightG - weightG;
    const TOLERANCE_G = 5;

    if (Math.abs(delta) < TOLERANCE_G) {
      res.json({
        action: "no_change",
        message: `Delta (${delta.toFixed(1)}g) dentro de tolerancia ±${TOLERANCE_G}g.`,
        currentWeightG: item.currentWeightG,
        newWeightG: weightG,
        delta,
      });
      return;
    }

    if (delta < 0) {
      await db.update(inventoryItemsTable)
        .set({ currentWeightG: weightG, initialWeightG: weightG, lastUpdated: new Date() })
        .where(eq(inventoryItemsTable.id, item.id));
      item.currentWeightG = weightG;
      item.initialWeightG = weightG;
      item.lastUpdated = new Date().toISOString();
      req.log.info({ productName: product.name, delta }, "Reposición detectada");
      sseEmit("restock", { item, delta, activeProduct });
      res.json({ action: "restock", message: "Reposición detectada.", delta, item });
      return;
    }

    const macros = calcMacros(product, delta);
    const consumptionId = uid();
    await db.insert(consumptionsTable).values({
      id: consumptionId,
      productId: product.id,
      productName: product.name,
      weightConsumedG: delta,
      ...macros,
      weightBefore: item.currentWeightG,
      weightAfter: weightG,
      deviceId: deviceId ?? null,
      timestamp: new Date(),
    });

    await db.update(inventoryItemsTable)
      .set({ currentWeightG: weightG, lastUpdated: new Date() })
      .where(eq(inventoryItemsTable.id, item.id));
    item.currentWeightG = weightG;
    item.lastUpdated = new Date().toISOString();

    const consumption: Consumption = {
      id: consumptionId,
      productId: product.id,
      productName: product.name,
      weightConsumedG: delta,
      ...macros,
      weightBefore: item.currentWeightG,
      weightAfter: weightG,
      deviceId,
      timestamp: new Date().toISOString(),
    };

    req.log.info({ productName: product.name, delta, calories: macros.calories }, "Consumo registrado vía Lógica Delta");
    sseEmit("consumption", { consumption, item, activeProduct });
    activeProduct = null;
    sseEmit("active_changed", { activeProduct: null });

    res.status(201).json({
      action: "consumption_recorded",
      message: `Consumo registrado: Δ ${delta.toFixed(1)}g de ${product.name}`,
      consumption,
      item,
    });
  } catch (err) {
    req.log.error({ err }, "Error en endpoint /reading");
    res.status(500).json({ error: "Error interno al procesar lectura" });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/nutritrack/consumptions
// ────────────────────────────────────────────────────────────────────────────
router.get("/nutritrack/consumptions", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const since = typeof req.query.since === "string" ? new Date(req.query.since) : undefined;

    let query = db.select().from(consumptionsTable)
      .orderBy(desc(consumptionsTable.timestamp))
      .limit(limit);

    if (since && !isNaN(since.getTime())) {
      query = query.where(gt(consumptionsTable.timestamp, since)) as typeof query;
    }

    const rows = await query;
    const consumptions: Consumption[] = rows.map((r: typeof consumptionsTable.$inferSelect) => ({
      id: r.id,
      productId: r.productId,
      productName: r.productName,
      weightConsumedG: r.weightConsumedG,
      calories: r.calories,
      protein: r.protein,
      carbs: r.carbs,
      fat: r.fat,
      weightBefore: r.weightBefore ?? 0,
      weightAfter: r.weightAfter ?? 0,
      deviceId: r.deviceId ?? undefined,
      timestamp: r.timestamp?.toISOString() ?? new Date().toISOString(),
    }));

    res.json({ consumptions, total: consumptions.length });
  } catch (err) {
    res.status(500).json({ error: "Database unavailable" });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// WEIGH COMMAND — user tells the ESP32 scale to perform a weighing
// ────────────────────────────────────────────────────────────────────────────

interface WeighCommand {
  userId: string;
  username: string;
  action: "weigh" | "tare" | "stop";
  commandAt: string;
}

let weighCommand: WeighCommand | null = null;

router.post("/nutritrack/weigh", authenticate, (req, res) => {
  const { action } = req.body;
  if (!action || !["weigh", "tare", "stop"].includes(action)) {
    res.status(400).json({ error: "Acción inválida. Usa 'weigh', 'tare' o 'stop'." });
    return;
  }
  weighCommand = {
    userId: req.user!.id,
    username: req.user!.username,
    action,
    commandAt: new Date().toISOString(),
  };
  sseEmit("weigh_command", { command: weighCommand });
  req.log.info({ user: req.user!.username, action }, "Comando enviado a la balanza");
  res.json({ message: `Comando "${action}" enviado a la balanza`, command: weighCommand });
});

router.get("/nutritrack/weigh/command", (req, res) => {
  const cmd = weighCommand;
  weighCommand = null;
  res.json({ command: cmd });
});

export default router;
