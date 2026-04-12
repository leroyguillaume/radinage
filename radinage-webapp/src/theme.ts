import { createTheme, type MantineColorsTuple } from "@mantine/core";

const green: MantineColorsTuple = [
	"#e8fbef",
	"#d3f3df",
	"#a5e6bc",
	"#74d896",
	"#4ccc77",
	"#33c463",
	"#24c058",
	"#14a948",
	"#04963e",
	"#008231",
];

export const theme = createTheme({
	primaryColor: "green",
	colors: {
		green,
	},
});
