import {
	Alert,
	Box,
	Button,
	Group,
	Loader,
	Paper,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import { IconAlertCircle, IconInfoCircle, IconPlus } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AccountForm } from "@/components/AccountForm";
import { AccountRow } from "@/components/AccountRow";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { formatAmount } from "@/lib/format";
import { useAccounts, useBudgets, useTransferRules } from "@/lib/hooks";
import { balanceTextColor, budgetTypeTones, neutralTone } from "@/lib/tones";
import { feederNames, feedersOf } from "@/lib/transfers";
import type { AccountResponse } from "@/lib/types";

export const Route = createFileRoute("/accounts")({
	component: AccountsPage,
});

type AccountGroup = "imported" | "savings" | "other";

const GROUPS: AccountGroup[] = ["imported", "savings", "other"];

function groupOf(account: AccountResponse): AccountGroup {
	if (account.receivesOperations) return "imported";
	return account.kind === "savings" ? "savings" : "other";
}

function sumBalances(accounts: AccountResponse[]): number {
	return accounts.reduce((sum, a) => sum + Number(a.currentBalance ?? 0), 0);
}

/** The account being edited, a new one, or none. */
type Editing =
	| { kind: "none" }
	| { kind: "new" }
	| { kind: "edit"; id: string };

export function AccountsPage() {
	const { t } = useTranslation();
	const accountsQuery = useAccounts();
	const budgets = useBudgets().data ?? [];
	const transferRules = useTransferRules().data ?? [];
	const [editing, setEditing] = useState<Editing>({ kind: "none" });
	const accounts = accountsQuery.data ?? [];
	const savedBy = (account: AccountResponse) =>
		feederNames(
			feedersOf(account.id, budgets, transferRules, accounts),
			(names) => t("transfers.fedBy", { accounts: names }),
		);
	const isEstimated = (account: AccountResponse) =>
		!account.receivesOperations &&
		(account.transferredInto || savedBy(account).length > 0);
	const stopEditing = () => setEditing({ kind: "none" });

	const members = (group: AccountGroup) =>
		accounts.filter((a) => groupOf(a) === group);
	const visibleGroups = GROUPS.filter((g) => members(g).length > 0);
	// From md, savings fill the right column beside the other two groups.
	const savingsBeside =
		visibleGroups.includes("savings") && visibleGroups.length > 1;
	const approx = (estimated: boolean) => (estimated ? "≈ " : "");

	const total = sumBalances(accounts);
	const imported = members("imported");
	const savings = members("savings");

	return (
		<div className="h-full overflow-auto">
			<Stack
				maw={1120}
				mx="auto"
				px={{ base: "md", sm: "lg" }}
				py={{ base: "md", sm: "xl" }}
				gap="lg"
			>
				<PageHeader
					title={t("accounts.title")}
					subtitle={t("accounts.description")}
					actions={
						editing.kind !== "new" && (
							<Button
								leftSection={<IconPlus size={20} />}
								onClick={() => setEditing({ kind: "new" })}
							>
								{t("accounts.add")}
							</Button>
						)
					}
				/>

				{editing.kind === "new" && (
					<Paper>
						<AccountForm
							account={null}
							onSaved={stopEditing}
							onCancel={stopEditing}
						/>
					</Paper>
				)}

				{accountsQuery.isLoading && (
					<Group justify="center">
						<Loader size="sm" />
					</Group>
				)}
				{accountsQuery.isError && (
					<Alert color="tangerine" icon={<IconAlertCircle size={16} />}>
						{t("accounts.fetchError")}
					</Alert>
				)}

				{accountsQuery.isSuccess && accounts.length === 0 && (
					<Paper>
						<Text size="sm" c="dimmed">
							{t("accounts.empty")}
						</Text>
					</Paper>
				)}

				{accounts.length > 0 && (
					<SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
						<StatTile
							label={t("accounts.totals.all")}
							value={`${approx(accounts.some(isEstimated))}${formatAmount(total)}`}
							valueColor={balanceTextColor(total)}
							dotColor={neutralTone.fill}
							hint={t("accounts.totals.count", { count: accounts.length })}
						/>
						{imported.length > 0 && (
							<StatTile
								label={t("accounts.groups.imported")}
								value={formatAmount(sumBalances(imported))}
								valueColor={balanceTextColor(sumBalances(imported))}
								dotColor={budgetTypeTones.income.fill}
								hint={t("accounts.totals.importedHint")}
							/>
						)}
						{savings.length > 0 && (
							<StatTile
								label={t("accounts.groups.savings")}
								value={`${approx(savings.some(isEstimated))}${formatAmount(sumBalances(savings))}`}
								valueColor={balanceTextColor(sumBalances(savings))}
								dotColor={budgetTypeTones.savings.fill}
								hint={t("accounts.totals.count", { count: savings.length })}
							/>
						)}
					</SimpleGrid>
				)}

				<Box className="grid items-start gap-4 md:grid-cols-2">
					{visibleGroups.map((group) => {
						const groupAccounts = members(group);
						return (
							<Paper
								key={group}
								component="section"
								aria-label={t(`accounts.groups.${group}`)}
								className={
									group === "savings" && savingsBeside
										? "md:col-start-2 md:row-span-2 md:row-start-1"
										: undefined
								}
							>
								<Stack gap={0}>
									<Group justify="space-between">
										<Text
											component="h2"
											size="xs"
											fw={700}
											c="dimmed"
											tt="uppercase"
											className="tracking-wide"
										>
											{t(`accounts.groups.${group}`)}
										</Text>
										<Text size="sm" fw={700} className="tabular-nums">
											{formatAmount(sumBalances(groupAccounts))}
										</Text>
									</Group>
									{group === "savings" && groupAccounts.some(isEstimated) && (
										<Alert
											color="gold"
											variant="light"
											c="gold.9"
											icon={<IconInfoCircle size={16} />}
											my="xs"
										>
											{t("accounts.estimateNote")}
										</Alert>
									)}
									<Box component="ul" m={0} p={0} className="list-none">
										{groupAccounts.map((account) =>
											editing.kind === "edit" && editing.id === account.id ? (
												<Box component="li" key={account.id} py="xs">
													<AccountForm
														account={account}
														onSaved={stopEditing}
														onCancel={stopEditing}
													/>
												</Box>
											) : (
												<AccountRow
													key={account.id}
													account={account}
													savedBy={savedBy(account)}
													onEdit={() =>
														setEditing({ kind: "edit", id: account.id })
													}
												/>
											),
										)}
									</Box>
								</Stack>
							</Paper>
						);
					})}
				</Box>
			</Stack>
		</div>
	);
}
