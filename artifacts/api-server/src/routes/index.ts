import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import routesRouter from "./routes";
import simulationRouter from "./simulation";
import paymentsRouter from "./payments";
import publicRouter from "./public";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(routesRouter);
router.use(simulationRouter);
router.use(paymentsRouter);
router.use(publicRouter);

export default router;
