import { createServerFn } from "@tanstack/react-start";

import { validateEmptyInput } from "#/features/accounts/account-function-input";
import { runAccountRead } from "#/features/accounts/account-function-runtime.server";
import { consumeRateLimit } from "#/features/accounts/rate-limit.server";
import { authorizeAccountFunction } from "#/features/accounts/sessions/account-authorization.middleware";
import { readAnonymousAnalyticsSummary } from "./anonymous-analytics.server";
import {
	enqueueAnonymousAnalyticsMetric,
	flushAnonymousAnalyticsMetrics,
} from "./anonymous-analytics-recorder.server";

const administratorAccount = authorizeAccountFunction("administrator");
const LANDING_VIEW_RATE_LIMIT_KEY = "anonymous-analytics:landing-view:global";
const LANDING_VIEW_RATE_LIMIT_MAXIMUM = 120;
const LANDING_VIEW_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export const recordLandingPageView = createServerFn({ method: "POST" })
	.validator(validateEmptyInput)
	.handler(async () => {
		const rateLimit = consumeRateLimit(
			LANDING_VIEW_RATE_LIMIT_KEY,
			LANDING_VIEW_RATE_LIMIT_MAXIMUM,
			LANDING_VIEW_RATE_LIMIT_WINDOW_MS,
		);
		if (!rateLimit.allowed) return null;
		enqueueAnonymousAnalyticsMetric("landing_page_loaded");
		return null;
	});

export const getAnonymousAnalyticsSummary = createServerFn({ method: "GET" })
	.middleware([administratorAccount])
	.handler(async () =>
		runAccountRead(() => {
			flushAnonymousAnalyticsMetrics();
			return readAnonymousAnalyticsSummary();
		}),
	);
