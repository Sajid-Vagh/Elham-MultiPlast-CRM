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
import categoriesRouter from "./categories";
import proformaInvoicesRouter from "./proforma-invoices";
import notificationsRouter from "./notifications";

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
router.use(categoriesRouter);
router.use(proformaInvoicesRouter);
router.use(notificationsRouter);

export default router;