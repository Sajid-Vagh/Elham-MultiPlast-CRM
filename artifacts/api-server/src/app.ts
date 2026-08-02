import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { UPLOADS_ROOT } from "./lib/storage";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api/uploads", express.static(UPLOADS_ROOT, { dotfiles: "deny" }));

app.use("/api", router);

app.use((err: any, _req: any, res: any, _next: any) => {
  logger.error({ err: err?.message, type: err?.type }, "Unhandled route error");

  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON in request body" });
  }

  res.status(err?.status ?? 500).json({
    success: false,
    error: "Internal Server Error",
  });
});

export default app;
