import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [
    {
      name: "require-env",
      configResolved(config) {
        if (config.command === "build" && !process.env.AUTH_URL && process.env.VITE_ZANE_LOCAL !== "1") {
          throw new Error("AUTH_URL environment variable is required for production builds.");
        }
      },
    },
    svelte(),
  ],
  define: {
    "import.meta.env.AUTH_URL": JSON.stringify(process.env.AUTH_URL ?? ""),
    "import.meta.env.VAPID_PUBLIC_KEY": JSON.stringify(process.env.VAPID_PUBLIC_KEY ?? ""),
    "import.meta.env.VITE_ZANE_LOCAL": JSON.stringify(process.env.VITE_ZANE_LOCAL ?? ""),
  },
});
