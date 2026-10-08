import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  use: {
    baseURL: process.env.TEST_WEB_URL || "http://localhost:5173",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: process.env.CHROMIUM_NO_SANDBOX === "true" ? ["--no-sandbox"] : [],
    },
  },
  webServer: [
    {
      command: "npm run dev:api",
      url:
        (process.env.TEST_API_URL || "http://127.0.0.1:3000/api/v1") +
        "/health",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev:web",
      url: process.env.TEST_WEB_URL || "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
