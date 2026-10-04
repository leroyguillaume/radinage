import {
	type CSSVariablesResolver,
	createTheme,
	type MantineColorsTuple,
} from "@mantine/core";

// Shade 7 is the logo outline green, used for actions and strong text.
const forest: MantineColorsTuple = [
	"#ecf6ef",
	"#d6ebdc",
	"#acd6b9",
	"#7fc096",
	"#5aa978",
	"#3f9463",
	"#327f56",
	"#296e4f",
	"#1f5a3f",
	"#15432f",
];

// For the three money tones below, shade 5 is the logo colour (bars, dots)
// and shade 8 the text colour that keeps 4.5:1 contrast on white.
const leaf: MantineColorsTuple = [
	"#eef8ef",
	"#e3f2e1",
	"#c7e6c6",
	"#a6d8a9",
	"#85ca8c",
	"#65bc6f",
	"#4fa85b",
	"#3b9049",
	"#2b7a47",
	"#1f5a35",
];

const tangerine: MantineColorsTuple = [
	"#fff4ea",
	"#fdebd8",
	"#fbd2ad",
	"#f9b77d",
	"#f7a656",
	"#f69a37",
	"#e07a1f",
	"#c2641a",
	"#b4541a",
	"#9a4512",
];

const gold: MantineColorsTuple = [
	"#fffbea",
	"#fff4cf",
	"#ffe89e",
	"#ffdb69",
	"#fdcf47",
	"#fdc635",
	"#e2ac1c",
	"#b88a10",
	"#8a6400",
	"#6b4e00",
];

export const palette = {
	background: "#f4f8f2",
	surface: "#ffffff",
	surfaceMuted: "#f7faf6",
	border: "#e1eadf",
	divider: "#edf2eb",
	text: "#17352a",
	dimmed: "#5a7064",
	track: "#edf2eb",
} as const;

export const headingFont =
	"'Bricolage Grotesque Variable', 'Plus Jakarta Sans Variable', sans-serif";

export const theme = createTheme({
	primaryColor: "forest",
	primaryShade: 7,
	colors: { forest, leaf, tangerine, gold },
	fontFamily: "'Plus Jakarta Sans Variable', system-ui, sans-serif",
	headings: { fontFamily: headingFont, fontWeight: "800" },
	defaultRadius: "md",
	radius: { xs: "6px", sm: "10px", md: "14px", lg: "18px", xl: "24px" },
	cursorType: "pointer",
	components: {
		Paper: { defaultProps: { radius: "xl", withBorder: true, p: "lg" } },
		Card: { defaultProps: { radius: "xl", withBorder: true } },
		Button: { defaultProps: { size: "md" } },
		TextInput: { defaultProps: { size: "md" } },
		PasswordInput: { defaultProps: { size: "md" } },
		NumberInput: { defaultProps: { size: "md" } },
		Select: { defaultProps: { size: "md" } },
		Autocomplete: { defaultProps: { size: "md" } },
		FileInput: { defaultProps: { size: "md" } },
		MonthPickerInput: { defaultProps: { size: "md" } },
		Modal: { defaultProps: { radius: "xl", centered: true } },
		Badge: { defaultProps: { radius: "xl", variant: "light" } },
		Progress: { defaultProps: { radius: "xl" } },
	},
});

export const cssVariablesResolver: CSSVariablesResolver = () => ({
	variables: {},
	light: {
		"--mantine-color-body": palette.background,
		"--mantine-color-text": palette.text,
		"--mantine-color-dimmed": palette.dimmed,
		"--mantine-color-default-border": palette.border,
	},
	dark: {},
});
