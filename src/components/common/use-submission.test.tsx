// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useSubmission } from "./use-submission";

function Harness({
	outcome,
	gate,
}: {
	outcome: () => "fail" | "ok";
	gate?: Promise<unknown>;
}) {
	const { isSubmitting, busyLabel, error, run } = useSubmission();
	return (
		<div>
			<button
				type="button"
				onClick={() =>
					void run(
						"Network failed.",
						async () => {
							await gate;
							if (outcome() === "fail") {
								throw new Error("boom");
							}
						},
						"Working…",
					)
				}
			>
				Start
			</button>
			<span>{isSubmitting ? "busy" : "idle"}</span>
			<span>{busyLabel ?? "no-label"}</span>
			{error ? <p role="alert">{error}</p> : null}
		</div>
	);
}

afterEach(cleanup);

describe("useSubmission", () => {
	it("reports a rejected operation instead of dropping the promise", async () => {
		render(<Harness outcome={() => "fail"} />);
		fireEvent.click(screen.getByRole("button", { name: "Start" }));
		expect(await screen.findByText("Network failed.")).toBeTruthy();
		expect(screen.getByText("idle")).toBeTruthy();
	});

	it("stays busy only for the duration of the operation", async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		render(<Harness gate={gate} outcome={() => "ok"} />);
		fireEvent.click(screen.getByRole("button", { name: "Start" }));
		expect(screen.getByText("busy")).toBeTruthy();
		expect(screen.getByText("Working…")).toBeTruthy();
		release();
		await waitFor(() => expect(screen.getByText("idle")).toBeTruthy());
		expect(screen.getByText("no-label")).toBeTruthy();
		expect(screen.queryByText("Network failed.")).toBeNull();
	});

	it("clears a previous error when a new operation starts", async () => {
		let mode: "fail" | "ok" = "fail";
		render(<Harness outcome={() => mode} />);
		fireEvent.click(screen.getByRole("button", { name: "Start" }));
		expect(await screen.findByText("Network failed.")).toBeTruthy();

		mode = "ok";
		fireEvent.click(screen.getByRole("button", { name: "Start" }));
		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
		expect(screen.getByText("idle")).toBeTruthy();
	});
});
