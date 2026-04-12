import { MantineProvider } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import "dayjs/locale/fr";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import { router } from "./router";
import "./styles.css";
import { theme } from "./theme";

const queryClient = new QueryClient();

const rootElement = document.getElementById("root");
if (rootElement) {
	createRoot(rootElement).render(
		<StrictMode>
			<QueryClientProvider client={queryClient}>
				<MantineProvider theme={theme}>
					<DatesProvider settings={{ locale: "fr" }}>
						<RouterProvider router={router} />
					</DatesProvider>
				</MantineProvider>
			</QueryClientProvider>
		</StrictMode>,
	);
}
