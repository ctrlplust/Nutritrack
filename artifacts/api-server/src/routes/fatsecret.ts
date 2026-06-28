import { Router, type Request, type Response } from "express";
import { searchFoods, getFoodDetail, searchByBarcode, getCacheStats } from "../lib/fatsecret";

const router = Router();

router.get("/fatsecret/search", async (req: Request, res: Response) => {
  try {
    const query = String(req.query["q"] || "");
    const maxResults = Math.min(Number(req.query["max"]) || 20, 50);

    if (!query.trim()) {
      res.status(400).json({ error: "Query parameter 'q' is required" });
      return;
    }

    const result = await searchFoods(query, maxResults);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: message });
  }
});

router.get("/fatsecret/food/:id", async (req: Request, res: Response) => {
  try {
    const detail = await getFoodDetail(req.params["id"]);
    if (!detail) {
      res.status(404).json({ error: "Food not found" });
      return;
    }
    res.json(detail);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: message });
  }
});

router.get("/fatsecret/barcode/:barcode", async (req: Request, res: Response) => {
  try {
    const result = await searchByBarcode(req.params["barcode"]);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(502).json({ error: message });
  }
});

router.get("/fatsecret/cache", (_req: Request, res: Response) => {
  res.json(getCacheStats());
});

export default router;
