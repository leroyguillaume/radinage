import { Box } from "@mantine/core";
import { MonthPickerInput } from "@mantine/dates";
import { IconChevronDown } from "@tabler/icons-react";
import dayjs from "dayjs";
import type { CSSProperties } from "react";
import { headingFont, palette } from "@/theme";

const LABEL_FORMAT = "MMMM YYYY";
const RIGHT_SECTION_WIDTH = 32;

const titleStyle: CSSProperties = {
	fontFamily: headingFont,
	fontSize: "clamp(1.5rem, 5vw, 2.5rem)",
	fontWeight: 800,
	letterSpacing: "-0.02em",
	textTransform: "capitalize",
	whiteSpace: "nowrap",
};

interface MonthTitlePickerProps {
	value: Date;
	locale: string;
	onChange: (date: Date) => void;
}

export function MonthTitlePicker({
	value,
	locale,
	onChange,
}: MonthTitlePickerProps) {
	const year = value.getFullYear();
	const labels = Array.from({ length: 12 }, (_, month) =>
		dayjs(new Date(year, month)).locale(locale).format(LABEL_FORMAT),
	);

	// The picker sizes itself to its label, so the arrows around it moved from
	// one month to the next. Every month label is stacked, invisible, in the
	// same grid cell to pin the width to the widest one.
	return (
		<Box
			miw={0}
			style={{
				display: "grid",
				gridTemplateColumns: "minmax(0, max-content)",
			}}
		>
			{labels.map((label) => (
				<Box
					key={label}
					aria-hidden
					data-testid="month-title-sizer"
					h={0}
					style={{
						...titleStyle,
						gridArea: "1 / 1",
						visibility: "hidden",
						overflow: "hidden",
						// The input's 1px border on each side.
						paddingInlineEnd: RIGHT_SECTION_WIDTH + 2,
					}}
				>
					{label}
				</Box>
			))}
			<MonthPickerInput
				value={value}
				onChange={(date) => {
					if (date) onChange(new Date(date));
				}}
				locale={locale}
				valueFormat={LABEL_FORMAT}
				variant="unstyled"
				miw={0}
				style={{ gridArea: "1 / 1" }}
				rightSection={<IconChevronDown size={20} color={palette.dimmed} />}
				rightSectionWidth={RIGHT_SECTION_WIDTH}
				rightSectionPointerEvents="none"
				styles={{
					input: {
						...titleStyle,
						height: "auto",
						minHeight: 44,
						lineHeight: 1.15,
						cursor: "pointer",
					},
				}}
			/>
		</Box>
	);
}
