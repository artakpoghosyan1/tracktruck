import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import routesRouter from "./routes";
import simulationRouter from "./simulation";
import paymentsRouter from "./payments";
import publicRouter from "./public";

const router: IRouter = Router();

// Public routes must be registered BEFORE the authenticated routes router
// because the routes router applies requireAuth() globally and would intercept
// any path that reaches it, including /public/*
router.use(healthRouter);
router.use(authRouter);
router.use(publicRouter);
// paymentsRouter must come before simulationRouter and routesRouter,
// because those routers apply requireAuth() globally and would intercept
// the unauthenticated /payments/callback webhook before it is handled here.
router.use(paymentsRouter);
router.use(simulationRouter);
router.use(routesRouter);

export default router;
