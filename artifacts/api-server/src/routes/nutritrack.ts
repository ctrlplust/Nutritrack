import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

// ────────────────────────────────────────────────────────────────────────────
// In-memory store
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

const products = new Map<string, Product>();
const inventory = new Map<string, InventoryItem>();
const consumptions: Consumption[] = [];

// Active product: the product the user has placed (or will place) on the scale
let activeProduct: { barcode: string; name: string; setAt: string } | null = null;

// SSE clients for real-time push to the mobile app
const sseClients = new Set<Response>();

function sseEmit(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}

// Seed with common products
const seedProducts: Product[] = [
  { id: "p1", barcode: "7802800053001", name: "Pechuga de Pollo", brand: "Super Pollo", caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6 },
  { id: "p2", barcode: "7802800012345", name: "Arroz Integral", brand: "Carozzi", caloriesPer100g: 362, proteinPer100g: 7.5, carbsPer100g: 76, fatPer100g: 2.7 },
  { id: "p3", barcode: "7802800099001", name: "Avena Tradicional", brand: "Quaker", caloriesPer100g: 389, proteinPer100g: 17, carbsPer100g: 66, fatPer100g: 7 },
  { id: "p4", barcode: "7802800055555", name: "Aceite de Oliva", brand: "Borges", caloriesPer100g: 884, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 100 },
  { id: "p5", barcode: "7802800011111", name: "Huevo Entero", brand: "Sopraval", caloriesPer100g: 155, proteinPer100g: 13, carbsPer100g: 1.1, fatPer100g: 11 },
  { id: "p6", barcode: "7802800022222", name: "Whey Protein", brand: "Optimum Nutrition", caloriesPer100g: 380, proteinPer100g: 75, carbsPer100g: 8, fatPer100g: 5 },
];
seedProducts.forEach(p => products.set(p.barcode, p));

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
  // Allow no barcode/name if activeProduct is set — resolved later
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
// GET /api/nutritrack/status
// ────────────────────────────────────────────────────────────────────────────
router.get("/nutritrack/status", (_req, res) => {
  res.json({
    status: "online",
    version: "2.0.0",
    products: products.size,
    inventoryItems: inventory.size,
    totalConsumptions: consumptions.length,
    activeProduct,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
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

  // Send current active product on connect
  res.write(`event: connected\ndata: ${JSON.stringify({ activeProduct, timestamp: new Date().toISOString() })}\n\n`);

  // Heartbeat every 15s to keep connection alive through proxies
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
  res.json({ activeProduct });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/nutritrack/active  — App avisa qué producto se pone en la balanza
// Body: { barcode?: string, productName?: string }
// Body vacío o { clear: true } para remover
// ────────────────────────────────────────────────────────────────────────────
router.post("/nutritrack/active", (req, res) => {
  const b = req.body as Record<string, unknown>;
  const barcode = typeof b.barcode === "string" ? b.barcode.trim() : null;
  const productName = typeof b.productName === "string" ? b.productName.trim() : null;
  const clear = b.clear === true || (!barcode && !productName);

  if (clear) {
    activeProduct = null;
    sseEmit("active_changed", { activeProduct: null });
    req.log.info("Producto activo removido");
    res.json({ message: "Producto activo removido", activeProduct: null });
    return;
  }

  const product = barcode
    ? products.get(barcode)
    : Array.from(products.values()).find(
        p => p.name.toLowerCase() === (productName ?? "").toLowerCase()
      );

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
router.get("/nutritrack/products", (_req, res) => {
  res.json({ products: Array.from(products.values()) });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/nutritrack/products
// ────────────────────────────────────────────────────────────────────────────
router.post("/nutritrack/products", (req, res) => {
  const parsed = validateProduct(req.body);
  if (!parsed) {
    res.status(400).json({ error: "Datos inválidos. Se requiere barcode y name." });
    return;
  }
  const { barcode, ...rest } = parsed;
  if (products.has(barcode)) {
    res.status(409).json({ error: "Producto ya registrado con ese código" });
    return;
  }
  const product: Product = { id: uid(), barcode, ...rest };
  products.set(barcode, product);
  req.log.info({ barcode, name: product.name }, "Producto registrado");
  res.status(201).json({ product });
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/nutritrack/inventory
// ────────────────────────────────────────────────────────────────────────────
router.get("/nutritrack/inventory", (_req, res) => {
  res.json({ inventory: Array.from(inventory.values()) });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/nutritrack/inventory
// ────────────────────────────────────────────────────────────────────────────
router.post("/nutritrack/inventory", (req, res) => {
  const parsed = validateInventory(req.body);
  if (!parsed) {
    res.status(400).json({ error: "Datos inválidos. Se requiere barcode (string) y weightG (number)." });
    return;
  }
  const { barcode, weightG, deviceId } = parsed;
  const product = products.get(barcode);
  if (!product) {
    res.status(404).json({ error: "Producto no encontrado. Registra el producto primero.", barcode });
    return;
  }
  const existing = Array.from(inventory.values()).find(i => i.product.barcode === barcode);
  if (existing) {
    existing.currentWeightG = weightG;
    existing.lastUpdated = new Date().toISOString();
    req.log.info({ barcode, weightG }, "Peso actualizado en inventario");
    res.json({ item: existing, updated: true });
    return;
  }
  const item: InventoryItem = {
    id: uid(), product, currentWeightG: weightG, initialWeightG: weightG,
    lastUpdated: new Date().toISOString(), deviceId,
  };
  inventory.set(item.id, item);
  req.log.info({ barcode, weightG }, "Producto agregado al inventario");
  res.status(201).json({ item, updated: false });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/nutritrack/reading  — ENDPOINT PRINCIPAL DEL ESP32
// Si no viene barcode ni productName, usa activeProduct automáticamente
// ────────────────────────────────────────────────────────────────────────────
router.post("/nutritrack/reading", (req, res) => {
  const parsed = validateReading(req.body);
  if (!parsed) {
    res.status(400).json({ error: "Payload inválido. Se requiere (barcode o productName) + (weightG o consumedG)." });
    return;
  }

  // Resolver identificador: body → activeProduct
  let { barcode, productName } = parsed;
  if (!barcode && !productName && activeProduct) {
    barcode = activeProduct.barcode;
  }

  const { weightG, consumedG, initialWeightG, deviceId } = parsed;

  const product = barcode
    ? products.get(barcode)
    : Array.from(products.values()).find(
        p => p.name.toLowerCase() === (productName ?? "").toLowerCase()
      );

  if (!product) {
    if (productName && !barcode) {
      const autoBarcode = "auto-" + productName.toLowerCase().replace(/\s+/g, "-");
      const autoProduct: Product = {
        id: uid(), barcode: autoBarcode, name: productName,
        caloriesPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0,
      };
      products.set(autoBarcode, autoProduct);

      const pesoFinal   = weightG   ?? 0;
      const pesoInicial = initialWeightG ?? (pesoFinal + (consumedG ?? 0));

      const newItem: InventoryItem = {
        id: uid(), product: autoProduct,
        currentWeightG: Math.max(0, pesoFinal),
        initialWeightG: pesoInicial,
        lastUpdated: new Date().toISOString(), deviceId,
      };
      inventory.set(newItem.id, newItem);

      // Si hay consumo, registrarlo también (macros en 0 hasta que la app sincronice)
      if (consumedG !== undefined && consumedG > 0) {
        const consumption: Consumption = {
          id: uid(), productId: autoProduct.id, productName: autoProduct.name,
          weightConsumedG: consumedG,
          calories: 0, protein: 0, carbs: 0, fat: 0,
          weightBefore: pesoInicial, weightAfter: Math.max(0, pesoFinal),
          deviceId, timestamp: new Date().toISOString(),
        };
        consumptions.unshift(consumption);
        sseEmit("consumption", { consumption, item: newItem, activeProduct });
        activeProduct = null;
        sseEmit("active_changed", { activeProduct: null });
        req.log.info({ productName, consumedG }, "Consumo de producto nuevo registrado (macros pendientes)");
        res.status(201).json({
          action: "consumption_recorded",
          message: `Consumo de ${consumedG}g de "${productName}" registrado. Sincroniza la app para ver las macros.`,
          consumption, item: newItem,
        });
      } else {
        sseEmit("inventory_created", { item: newItem, activeProduct });
        activeProduct = null;
        sseEmit("active_changed", { activeProduct: null });
        res.status(201).json({
          action: "inventory_created",
          message: `Producto "${productName}" registrado automáticamente.`,
          item: newItem, delta: null,
        });
      }
      return;
    }
    res.status(404).json({ error: "Producto no encontrado y no hay producto activo.", barcode, productName });
    return;
  }

  let item = Array.from(inventory.values()).find(i => i.product.barcode === product.barcode);

  // ── RAMA A: ESP32 FSM ya calculó el delta ──────────────────────────────────
  if (consumedG !== undefined && consumedG > 0) {
    const pesoFinal = weightG ?? (item ? item.currentWeightG - consumedG : 0);
    const pesoInicial = initialWeightG ?? (item ? item.currentWeightG : pesoFinal + consumedG);

    if (!item) {
      const newItem: InventoryItem = {
        id: uid(), product, initialWeightG: pesoInicial,
        currentWeightG: Math.max(0, pesoFinal), lastUpdated: new Date().toISOString(), deviceId,
      };
      inventory.set(newItem.id, newItem);
      item = newItem;
    } else {
      item.currentWeightG = Math.max(0, pesoFinal);
      item.lastUpdated = new Date().toISOString();
    }

    const macros = calcMacros(product, consumedG);
    const consumption: Consumption = {
      id: uid(), productId: product.id, productName: product.name,
      weightConsumedG: consumedG, ...macros,
      weightBefore: pesoInicial, weightAfter: Math.max(0, pesoFinal),
      deviceId, timestamp: new Date().toISOString(),
    };
    consumptions.unshift(consumption);

    req.log.info({ productName: product.name, consumedG, calories: macros.calories }, "Consumo ESP32-FSM registrado");

    // Push real-time event to all connected apps
    sseEmit("consumption", { consumption, item, activeProduct });
    activeProduct = null;
    sseEmit("active_changed", { activeProduct: null });

    res.status(201).json({
      action: "consumption_recorded",
      message: `Consumo registrado: Δ ${consumedG}g de ${product.name}`,
      consumption, item,
    });
    return;
  }

  // ── RAMA B: ESP32 envía peso actual, servidor calcula delta ────────────────
  if (weightG === undefined) {
    res.status(400).json({ error: "Se requiere weightG o consumedG." });
    return;
  }

  if (!item) {
    const newItem: InventoryItem = {
      id: uid(), product, currentWeightG: weightG, initialWeightG: weightG,
      lastUpdated: new Date().toISOString(), deviceId,
    };
    inventory.set(newItem.id, newItem);
    req.log.info({ productName: product.name, weightG }, "Primera lectura — inventario creado");
    sseEmit("inventory_created", { item: newItem, activeProduct });
    activeProduct = null;
    sseEmit("active_changed", { activeProduct: null });
    res.status(201).json({ action: "inventory_created", message: "Primer registro.", item: newItem, delta: null });
    return;
  }

  const delta = item.currentWeightG - weightG;
  const TOLERANCE_G = 5;

  if (Math.abs(delta) < TOLERANCE_G) {
    res.json({
      action: "no_change",
      message: `Delta (${delta.toFixed(1)}g) dentro de tolerancia ±${TOLERANCE_G}g.`,
      currentWeightG: item.currentWeightG, newWeightG: weightG, delta,
    });
    return;
  }

  if (delta < 0) {
    item.currentWeightG = weightG;
    item.initialWeightG = weightG;
    item.lastUpdated = new Date().toISOString();
    req.log.info({ productName: product.name, delta }, "Reposición detectada");
    sseEmit("restock", { item, delta, activeProduct });
    activeProduct = null;
    sseEmit("active_changed", { activeProduct: null });
    res.json({ action: "restock", message: "Reposición detectada.", delta, item });
    return;
  }

  const macros = calcMacros(product, delta);
  const consumption: Consumption = {
    id: uid(), productId: product.id, productName: product.name,
    weightConsumedG: delta, ...macros,
    weightBefore: item.currentWeightG, weightAfter: weightG,
    deviceId, timestamp: new Date().toISOString(),
  };
  consumptions.unshift(consumption);
  item.currentWeightG = weightG;
  item.lastUpdated = new Date().toISOString();

  req.log.info({ productName: product.name, delta, calories: macros.calories }, "Consumo registrado vía Lógica Delta");
  sseEmit("consumption", { consumption, item, activeProduct });
  activeProduct = null;
  sseEmit("active_changed", { activeProduct: null });

  res.status(201).json({
    action: "consumption_recorded",
    message: `Consumo registrado: Δ ${delta.toFixed(1)}g de ${product.name}`,
    consumption, item,
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/nutritrack/consumptions
// ────────────────────────────────────────────────────────────────────────────
router.get("/nutritrack/consumptions", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const since = typeof req.query.since === "string" ? new Date(req.query.since).getTime() : 0;
  const filtered = isNaN(since)
    ? consumptions
    : consumptions.filter(c => new Date(c.timestamp).getTime() > since);
  res.json({ consumptions: filtered.slice(0, limit), total: filtered.length });
});

export default router;
