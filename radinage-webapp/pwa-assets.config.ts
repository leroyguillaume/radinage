import { defineConfig } from "@vite-pwa/assets-generator/config";

const background = "#f4f8f2";

// The wallet's bottom corners sit 0.57 × the logo's side from its centre:
// 35% padding brings them to 0.37, inside the 0.4 safe-zone radius a launcher
// may crop a maskable icon to.
export default defineConfig({
	headLinkOptions: { preset: "2023" },
	images: ["public/logo.svg"],
	preset: {
		transparent: { sizes: [192, 512] },
		maskable: {
			sizes: [512],
			padding: 0.35,
			resizeOptions: { background },
		},
		apple: {
			sizes: [180],
			padding: 0.2,
			resizeOptions: { background },
		},
	},
});
