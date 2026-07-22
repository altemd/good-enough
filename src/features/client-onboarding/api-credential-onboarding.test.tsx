// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { discoverOpenAiModelIds } from "#/features/inference-gateway/openai-model-discovery";

import { ApiCredentialOnboarding } from "./api-credential-onboarding";

vi.mock("#/features/inference-gateway/openai-model-discovery", () => ({
	discoverOpenAiModelIds: vi.fn(),
}));

const API_KEY = "ge_personal_selector_private-secret";

beforeEach(() => {
	vi.mocked(discoverOpenAiModelIds).mockReset();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("API credential onboarding", () => {
	it("shows the key immediately and copies generated JSON without browser persistence", async () => {
		vi.mocked(discoverOpenAiModelIds).mockResolvedValue(["z-model", "a-model"]);
		const onModelsDiscovered = vi.fn();
		const writeText = vi.fn<(value: string) => Promise<void>>(() =>
			Promise.resolve(),
		);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		const storageWrite = vi.spyOn(Storage.prototype, "setItem");

		render(
			<ApiCredentialOnboarding
				apiKey={API_KEY}
				onModelsDiscovered={onModelsDiscovered}
				onDismiss={vi.fn()}
			/>,
		);

		expect(screen.getByText(API_KEY)).toBeTruthy();
		expect(
			screen.getByText(/Inference content is not persisted/u),
		).toBeTruthy();
		expect(screen.getByText("Discovering available models…")).toBeTruthy();
		expect(screen.getByText("~/.config/opencode/opencode.json")).toBeTruthy();
		expect(screen.getByText("opencode.json")).toBeTruthy();
		expect(storageWrite).not.toHaveBeenCalled();
		const copyKey = screen.getByRole("button", {
			name: "Copy temporary API key",
		});
		expect(copyKey.textContent).toBe("");
		expect(copyKey.getAttribute("title")).toBe("Copy");
		fireEvent.click(copyKey);
		await waitFor(() => expect(writeText).toHaveBeenCalledWith(API_KEY));
		expect(
			screen
				.getByRole("button", { name: "Temporary API key copied" })
				.getAttribute("title"),
		).toBe("Copied");

		const config = await screen.findByLabelText("OpenCode configuration");
		const copyConfig = screen.getByRole("button", {
			name: "Copy OpenCode configuration",
		});
		expect(copyConfig.textContent).toBe("");
		expect(copyConfig.getAttribute("title")).toBe("Copy");
		fireEvent.click(copyConfig);
		await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
		expect(
			screen
				.getByRole("button", { name: "OpenCode configuration copied" })
				.getAttribute("title"),
		).toBe("Copied");
		const copiedConfig = JSON.parse(String(writeText.mock.calls[1]?.[0]));
		expect(copiedConfig.provider["good-enough"].options).toEqual({
			baseURL: new URL("/v1", window.location.origin).href,
			apiKey: API_KEY,
		});
		expect(Object.keys(copiedConfig.provider["good-enough"].models)).toEqual([
			"a-model",
			"z-model",
		]);
		expect(config.textContent).toContain(API_KEY);
		expect(onModelsDiscovered).toHaveBeenCalledWith(["z-model", "a-model"]);
		expect(storageWrite).not.toHaveBeenCalled();
	});

	it("preserves the key when discovery fails and can retry", async () => {
		vi.mocked(discoverOpenAiModelIds)
			.mockRejectedValueOnce(new Error("private discovery detail"))
			.mockResolvedValueOnce(["local-model"]);

		render(<ApiCredentialOnboarding apiKey={API_KEY} onDismiss={vi.fn()} />);

		await screen.findByRole("alert");
		expect(screen.getByText(API_KEY)).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Retry model discovery" }),
		);
		await screen.findByLabelText("OpenCode configuration");
		expect(discoverOpenAiModelIds).toHaveBeenCalledTimes(2);
		expect(document.body.textContent).not.toContain("private discovery detail");
	});

	it("aborts discovery and removes the plaintext key when dismissed", async () => {
		let discoverySignal: AbortSignal | undefined;
		vi.mocked(discoverOpenAiModelIds).mockImplementation((_apiKey, options) => {
			discoverySignal = options?.signal;
			return new Promise((_resolve, reject) => {
				options?.signal?.addEventListener("abort", () =>
					reject(new DOMException("Aborted", "AbortError")),
				);
			});
		});

		render(<DismissibleOnboarding />);
		expect(screen.getByText(API_KEY)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

		expect(discoverySignal?.aborted).toBe(true);
		expect(screen.queryByText(API_KEY)).toBeNull();
	});
});

function DismissibleOnboarding() {
	const [visible, setVisible] = useState(true);
	return visible ? (
		<ApiCredentialOnboarding
			apiKey={API_KEY}
			onDismiss={() => setVisible(false)}
		/>
	) : null;
}
