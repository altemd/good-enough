import { PageLayout } from "#/components/ui/page-layout";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";

import type { AnonymousAnalyticsSummary } from "../anonymous-analytics.server";

export function AnonymousAnalyticsPage({
	summary,
}: {
	summary: AnonymousAnalyticsSummary;
}) {
	return (
		<PageLayout title="Anonymous analytics">
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
				<div className="mt-4">
					<Table className="min-w-[48rem] text-sm">
						<TableHeader>
							<TableRow>
								<TableHead className="pr-4 whitespace-nowrap">Hour</TableHead>
								<TableHead>Views</TableHead>
								<TableHead>Keys</TableHead>
								<TableHead>Started</TableHead>
								<TableHead>Completed</TableHead>
								<TableHead>Rejected</TableHead>
								<TableHead>Failed</TableHead>
								<TableHead className="pl-2">Cancelled</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{summary.recentBuckets.map((bucket) => (
								<TableRow key={bucket.bucketStartedAt}>
									<TableCell className="pr-4 whitespace-nowrap">
										{formatHour(bucket.bucketStartedAt)}
									</TableCell>
									<TableCell>{bucket.landingPageLoads}</TableCell>
									<TableCell>{bucket.demoCredentialsIssued}</TableCell>
									<TableCell>{bucket.demoInferenceStarted}</TableCell>
									<TableCell>{bucket.demoInferenceCompleted}</TableCell>
									<TableCell>{bucket.demoInferenceRejected}</TableCell>
									<TableCell>{bucket.demoInferenceFailed}</TableCell>
									<TableCell className="pl-2">
										{bucket.demoInferenceCancelled}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</PageLayout>
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
