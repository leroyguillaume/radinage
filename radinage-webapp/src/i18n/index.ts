import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

const resources = {
	fr: { translation: fr },
	en: { translation: en },
} as const;

i18n.use(initReactI18next).init({
	resources,
	lng: navigator.language.startsWith("fr") ? "fr" : "en",
	fallbackLng: "en",
	interpolation: {
		escapeValue: false,
	},
});

export { i18n };
