import { AccountPageLayout } from "#/features/accounts/ui/account-page-layout";
import type { AnonymousAnalyticsSummary } from "../anonymous-analytics.server";

export function AnonymousAnalyticsPage({
	summary,
}: {
	summary: AnonymousAnalyticsSummary;
}) {
	return (
		<AccountPageLayout title="Anonymous analytics">
			<p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
				Anonymous aggregate totals are retained. Landing views are rendered page
				views, not unique visitors, and no IP address, browser identifier,
				account, API key, request ID, model, or inference content is stored
				here.
			</p>

			<dl className="mt-8 grid gap-4 sm:grid-cols-3">
				<SummaryCard
					label="Rendered landing views"
					value={summary.totals.landingPageLoads}
				/>
				<SummaryCard
					label="Demo credentials issued"
					value={summary.totals.demoCredentialsIssued}
				/>
				<SummaryCard
					label="Demo requests started"
					value={summary.totals.demoInferenceStarted}
				/>
			</dl>

			<h2 className="mt-10 text-xl font-semibold">Recent hourly activity</h2>
			{summary.recentBuckets.length === 0 ? (
				<p className="mt-4 text-muted-foreground">No activity recorded yet.</p>
			) : (
				<div className="mt-4 overflow-x-auto">
					<table className="w-full min-w-[48rem] text-left text-sm">
						<thead>
							<tr className="border-b">
								<th className="py-3 pr-4">Hour</th>
								<th className="px-2 py-3">Views</th>
								<th className="px-2 py-3">Keys</th>
								<th className="px-2 py-3">Started</th>
								<th className="px-2 py-3">Completed</th>
								<th className="px-2 py-3">Rejected</th>
								<th className="px-2 py-3">Failed</th>
								<th className="pl-2 py-3">Cancelled</th>
							</tr>
						</thead>
						<tbody>
							{summary.recentBuckets.map((bucket) => (
								<tr className="border-b" key={bucket.bucketStartedAt}>
									<td className="py-3 pr-4 whitespace-nowrap">
										{formatHour(bucket.bucketStartedAt)}
									</td>
									<td className="px-2 py-3">{bucket.landingPageLoads}</td>
									<td className="px-2 py-3">{bucket.demoCredentialsIssued}</td>
									<td className="px-2 py-3">{bucket.demoInferenceStarted}</td>
									<td className="px-2 py-3">{bucket.demoInferenceCompleted}</td>
									<td className="px-2 py-3">{bucket.demoInferenceRejected}</td>
									<td className="px-2 py-3">{bucket.demoInferenceFailed}</td>
									<td className="pl-2 py-3">{bucket.demoInferenceCancelled}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</AccountPageLayout>
	);
}

function SummaryCard({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-2xl border bg-card p-5">
			<dt className="text-sm text-muted-foreground">{label}</dt>
			<dd className="mt-2 text-3xl font-semibold tabular-nums">{value}</dd>
		</div>
	);
}

function formatHour(timestamp: number): string {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "UTC",
	}).format(timestamp);
}
