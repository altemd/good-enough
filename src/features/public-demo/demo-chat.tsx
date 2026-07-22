import { RotateCcw } from "lucide-react";
import { type SubmitEvent, useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { DemoChatComposer } from "./demo-chat-composer";
import { DemoChatDeltaBuffer } from "./demo-chat-delta-buffer";
import type { DemoChatMessage } from "./demo-chat-message";
import { DemoChatTranscript } from "./demo-chat-transcript";
import {
	type DemoChatDelta,
	DemoChatError,
	streamDemoChat,
} from "./demo-chat-transport";

export function DemoChat({
	apiKey,
	models,
}: {
	apiKey: string;
	models: string[];
}) {
	const [model, setModel] = useState(models[0] ?? "");
	const [messages, setMessages] = useState<DemoChatMessage[]>([]);
	const [prompt, setPrompt] = useState("");
	const [requestError, setRequestError] = useState<string | null>(null);
	const [isStreaming, setIsStreaming] = useState(false);
	const [forceScrollKey, setForceScrollKey] = useState(0);
	const abortController = useRef<AbortController | null>(null);
	const nextMessageId = useRef(1);

	useEffect(() => () => abortController.current?.abort(), []);

	async function submitPrompt(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault();
		const content = prompt.trim();
		if (!content || !model || isStreaming) return;

		const userMessage: DemoChatMessage = {
			id: nextMessageId.current++,
			role: "user",
			content,
			reasoning: "",
			status: "complete",
		};
		const assistantId = nextMessageId.current++;
		const assistantMessage: DemoChatMessage = {
			id: assistantId,
			role: "assistant",
			content: "",
			reasoning: "",
			status: "streaming",
		};
		const requestMessages = [...messages, userMessage]
			.filter(
				(message) => message.content.length > 0 || message.reasoning.length > 0,
			)
			.map(({ role, content: messageContent, reasoning }) => ({
				role,
				content: messageContent,
				...(role === "assistant" && reasoning
					? { reasoning_content: reasoning }
					: {}),
			}));

		setMessages((current) => [...current, userMessage, assistantMessage]);
		setPrompt("");
		setRequestError(null);
		setIsStreaming(true);
		setForceScrollKey((value) => value + 1);
		const controller = new AbortController();
		abortController.current = controller;
		const deltaBuffer = new DemoChatDeltaBuffer((delta) =>
			appendDelta(assistantId, delta),
		);

		try {
			await streamDemoChat({
				apiKey,
				model,
				messages: requestMessages,
				signal: controller.signal,
				onDelta: (delta) => deltaBuffer.enqueue(delta),
			});
			deltaBuffer.flush();
			setAssistantStatus(assistantId, "complete");
		} catch (error) {
			deltaBuffer.flush();
			if (controller.signal.aborted) {
				setAssistantStatus(assistantId, "stopped");
			} else {
				setAssistantStatus(assistantId, "failed");
				setRequestError(messageFor(error));
			}
		} finally {
			if (abortController.current === controller) {
				abortController.current = null;
				setIsStreaming(false);
			}
		}
	}

	function appendDelta(assistantId: number, delta: DemoChatDelta) {
		setMessages((current) =>
			current.map((message) => {
				if (message.id !== assistantId) return message;
				return {
					...message,
					content: `${message.content}${delta.content ?? ""}`,
					reasoning: `${message.reasoning}${delta.reasoning ?? ""}`,
				};
			}),
		);
	}

	function startNewConversation() {
		setMessages([]);
		setPrompt("");
		setRequestError(null);
		setForceScrollKey((value) => value + 1);
	}

	function setAssistantStatus(
		assistantId: number,
		status: DemoChatMessage["status"],
	) {
		setMessages((current) =>
			current.map((message) =>
				message.id === assistantId ? { ...message, status } : message,
			),
		);
	}

	return (
		<>
			<header className="flex flex-wrap items-center gap-3 border-b px-5 py-4 sm:px-7">
				<div>
					<div className="flex items-center gap-2">
						<h2 className="font-semibold">Live demo chat</h2>
						<span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
							Ephemeral
						</span>
					</div>
					<p className="mt-1 text-xs text-muted-foreground">
						This tab keeps the complete conversation. Refreshing or dismissing
						the token clears it.
					</p>
				</div>
				<div className="ml-auto flex flex-wrap items-center gap-3">
					{messages.length > 0 ? (
						<Button
							type="button"
							variant="outline"
							disabled={isStreaming}
							onClick={startNewConversation}
						>
							<RotateCcw data-icon="inline-start" />
							New conversation
						</Button>
					) : null}
					{models.length > 0 ? (
						<label className="text-xs text-muted-foreground">
							Model
							<select
								className="ml-2 max-w-64 rounded-xl border bg-background px-3 py-2 text-sm text-foreground"
								value={model}
								disabled={isStreaming}
								onChange={(event) => setModel(event.currentTarget.value)}
							>
								{models.map((availableModel) => (
									<option key={availableModel} value={availableModel}>
										{availableModel}
									</option>
								))}
							</select>
						</label>
					) : null}
				</div>
			</header>

			<DemoChatTranscript messages={messages} forceScrollKey={forceScrollKey} />

			<DemoChatComposer
				prompt={prompt}
				modelReady={model.length > 0}
				isStreaming={isStreaming}
				error={requestError}
				onPromptChange={setPrompt}
				onSubmit={submitPrompt}
				onStop={() => abortController.current?.abort()}
			/>
		</>
	);
}

function messageFor(error: unknown) {
	return error instanceof DemoChatError
		? error.message
		: "The demo chat could not continue. Try again.";
}
