import { createFileRoute, redirect } from "@tanstack/react-router";

import { getAnonymousAnalyticsSummary } from "#/features/operations-analytics/anonymous-analytics.functions";
import { AnonymousAnalyticsPage } from "#/features/operations-analytics/ui/anonymous-analytics-page";

export const Route = createFileRoute("/_authenticated/admin/analytics")({
	loader: async () => {
		const summary = await getAnonymousAnalyticsSummary();
		if (!summary) throw redirect({ to: "/account" });
		return summary;
	},
	component: AnalyticsRoute,
});

function AnalyticsRoute() {
	return <AnonymousAnalyticsPage summary={Route.useLoaderData()} />;
}
