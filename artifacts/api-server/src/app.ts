import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

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
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api", router);

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("GLOBAL ERROR:", err);

  res.status(err?.status ?? 500).json({
    error: "Internal server error",
    message: err?.message ?? String(err),
    stack:
      process.env.NODE_ENV !== "production"
        ? err?.stack
        : undefined,
  });
});

export default app;
