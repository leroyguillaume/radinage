import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
			"virtual:pwa-register/react": resolve(
				__dirname,
				"src/__tests__/pwa-register.ts",
			),
		},
	},
	test: {
		globals: true,
		environment: "jsdom",
		setupFiles: ["./src/test-setup.ts"],
		css: true,
	},
});
