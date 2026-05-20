import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import contactsRouter from "./contacts";
import productsRouter from "./products";
import dealsRouter from "./deals";
import activitiesRouter from "./activities";
import reportsRouter from "./reports";
import importRouter from "./import";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(contactsRouter);
router.use(productsRouter);
router.use(dealsRouter);
router.use(activitiesRouter);
router.use(reportsRouter);
router.use(importRouter);

export default router;
