import { Router, type IRouter } from "express";
import healthRouter from "./health";
import nutritrackRouter from "./nutritrack";
import authRouter from "./auth";
import fatsecretRouter from "./fatsecret";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(nutritrackRouter);
router.use(fatsecretRouter);

export default router;
