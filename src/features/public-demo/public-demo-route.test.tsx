// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PublicDemoRoutePage } from "./public-demo-route";

const accountFunctions = vi.hoisted(() => ({
	createDemoApiToken: vi.fn(),
}));
const analyticsFunctions = vi.hoisted(() => ({
	recordLandingPageView: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
	useServerFn: (serverFunction: unknown) => serverFunction,
}));
vi.mock(
	"#/features/accounts/api-keys/api-key.functions",
	() => accountFunctions,
);
vi.mock(
	"#/features/operations-analytics/anonymous-analytics.functions",
	() => analyticsFunctions,
);
vi.mock("./public-demo-page.tsx", () => ({
	PublicDemoPage: () => <div>Rendered public demo</div>,
}));

beforeEach(() => {
	vi.clearAllMocks();
	analyticsFunctions.recordLandingPageView.mockResolvedValue(null);
});

afterEach(cleanup);

describe("public demo route analytics", () => {
	it("records one view after rendering", async () => {
		const { rerender } = render(
			<PublicDemoRoutePage
				account={null}
				entryState={{
					setupRequired: false,
					registrationEnabled: true,
					configurationValid: true,
				}}
			/>,
		);
		await waitFor(() =>
			expect(analyticsFunctions.recordLandingPageView).toHaveBeenCalledOnce(),
		);
		expect(analyticsFunctions.recordLandingPageView).toHaveBeenCalledWith({
			data: {},
		});

		rerender(
			<PublicDemoRoutePage
				account={null}
				entryState={{
					setupRequired: false,
					registrationEnabled: true,
					configurationValid: true,
				}}
			/>,
		);
		expect(analyticsFunctions.recordLandingPageView).toHaveBeenCalledOnce();
	});
});
