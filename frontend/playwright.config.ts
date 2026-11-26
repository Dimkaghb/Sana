import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const localChrome =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export default defineConfig({
  testDir: "tests",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5197",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.SANA_TEST_CHROME ||
        (existsSync(localChrome) ? localChrome : undefined),
    },
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5197 --strictPort",
    url: "http://127.0.0.1:5197",
    reuseExistingServer: false,
  },
});
