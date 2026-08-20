import pino from "pino";
import { sanitizeLogRecord } from "./security/log-sanitizer.js";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  formatters: {
    log(record) {
      return sanitizeLogRecord(record);
    },
  },
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    "*.authorization",
    "*.cookie",
    "*.password",
    "*.secret",
    "*.token",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
