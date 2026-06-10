import { Router, type IRouter } from "express";
import healthRouter from "./health";
import nutritrackRouter from "./nutritrack";

const router: IRouter = Router();

router.use(healthRouter);
router.use(nutritrackRouter);

export default router;
