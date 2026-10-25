import { Box, SimpleGrid, type SimpleGridProps } from "@mantine/core";

/**
 * A `SimpleGrid` whose `cols` breakpoints are widths of the grid itself, not
 * of the viewport: the sidebar takes a varying share of the screen, so a
 * viewport breakpoint can hand each column far less room than it needs.
 */
export function ContainerGrid(props: Omit<SimpleGridProps, "type">) {
	return (
		<Box style={{ containerType: "inline-size" }}>
			<SimpleGrid type="container" {...props} />
		</Box>
	);
}
