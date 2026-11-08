import type { useRegisterSW as UseRegisterSW } from "virtual:pwa-register/react";

/** Stands in for the module `vite-plugin-pwa` generates at build time: no service worker under test. */
export const useRegisterSW: typeof UseRegisterSW = () => ({
	needRefresh: [false, () => undefined],
	offlineReady: [false, () => undefined],
	updateServiceWorker: async () => undefined,
});
