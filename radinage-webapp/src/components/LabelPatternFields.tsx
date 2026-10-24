import { Select, TextInput } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { LabelPattern } from "@/lib/types";

export type PatternType = LabelPattern["type"];

const patternTypes: PatternType[] = ["contains", "startsWith", "endsWith"];

function isPatternType(value: string | null): value is PatternType {
	return patternTypes.some((t) => t === value);
}

/** The criterion and value of a rule matching operation labels, as siblings of a row. */
export function LabelPatternFields({
	type,
	value,
	onTypeChange,
	onValueChange,
}: {
	type: PatternType;
	value: string;
	onTypeChange: (type: PatternType) => void;
	onValueChange: (value: string) => void;
}) {
	const { t } = useTranslation();
	return (
		<>
			<Select
				label={t("rules.patternType")}
				value={type}
				onChange={(v) => {
					if (isPatternType(v)) onTypeChange(v);
				}}
				allowDeselect={false}
				data={patternTypes.map((p) => ({
					value: p,
					label: t(`rules.patterns.${p}`),
				}))}
				style={{ flex: "1 1 140px" }}
			/>
			<TextInput
				label={t("rules.patternValue")}
				value={value}
				onChange={(e) => onValueChange(e.currentTarget.value)}
				style={{ flex: "2 1 180px" }}
			/>
		</>
	);
}
