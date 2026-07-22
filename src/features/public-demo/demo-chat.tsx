import { Bot, LoaderCircle, RotateCcw } from "lucide-react";
import { type SubmitEvent, useEffect, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { DemoChatComposer } from "./demo-chat-composer";
import { type DemoChatMessage, DemoChatMessageView } from "./demo-chat-message";
import {
	type DemoChatDelta,
	DemoChatError,
	loadDemoModels,
	streamDemoChat,
} from "./demo-chat-transport";

export function DemoChat({ apiKey }: { apiKey: string }) {
	const [models, setModels] = useState<string[]>([]);
	const [model, setModel] = useState("");
	const [modelError, setModelError] = useState<string | null>(null);
	const [modelAttempt, setModelAttempt] = useState(0);
	const [messages, setMessages] = useState<DemoChatMessage[]>([]);
	const [prompt, setPrompt] = useState("");
	const [requestError, setRequestError] = useState<string | null>(null);
	const [isStreaming, setIsStreaming] = useState(false);
	const abortController = useRef<AbortController | null>(null);
	const nextMessageId = useRef(1);

	useEffect(() => {
		void modelAttempt;
		const controller = new AbortController();
		setModels([]);
		setModel("");
		setModelError(null);
		loadDemoModels(apiKey, { signal: controller.signal })
			.then((availableModels) => {
				if (controller.signal.aborted) return;
				setModels(availableModels);
				setModel(availableModels[0] ?? "");
			})
			.catch((error: unknown) => {
				if (!controller.signal.aborted) setModelError(messageFor(error));
			});
		return () => controller.abort();
	}, [apiKey, modelAttempt]);

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
		const controller = new AbortController();
		abortController.current = controller;

		try {
			await streamDemoChat({
				apiKey,
				model,
				messages: requestMessages,
				signal: controller.signal,
				onDelta: (delta) => appendDelta(assistantId, delta),
			});
			setAssistantStatus(assistantId, "complete");
		} catch (error) {
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
		<section className="mx-auto max-w-6xl px-5 pb-16 sm:px-8 lg:pb-24">
			<div className="overflow-hidden rounded-3xl border bg-card shadow-xl shadow-black/5">
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

				<div
					className="min-h-96 space-y-5 bg-muted/20 p-5 sm:p-7"
					aria-live="polite"
				>
					{models.length === 0 && !modelError ? (
						<EmptyState
							icon={<LoaderCircle className="animate-spin" />}
							title="Finding the local model"
							body="Model discovery does not consume generation capacity."
						/>
					) : null}
					{modelError ? (
						<EmptyState
							icon={<RotateCcw />}
							title="Chat is unavailable"
							body={modelError}
							action={
								<Button
									type="button"
									variant="outline"
									onClick={() => setModelAttempt((value) => value + 1)}
								>
									Try model discovery again
								</Button>
							}
						/>
					) : null}
					{models.length > 0 && messages.length === 0 ? (
						<EmptyState
							icon={<Bot />}
							title="Ask the local model"
							body="Responses stream into this page and are not saved by the service."
						/>
					) : null}
					{messages.map((message) => (
						<DemoChatMessageView key={message.id} message={message} />
					))}
				</div>

				<DemoChatComposer
					prompt={prompt}
					modelReady={model.length > 0}
					isStreaming={isStreaming}
					error={requestError}
					onPromptChange={setPrompt}
					onSubmit={submitPrompt}
					onStop={() => abortController.current?.abort()}
				/>
			</div>
		</section>
	);
}

function EmptyState({
	icon,
	title,
	body,
	action,
}: {
	icon: React.ReactNode;
	title: string;
	body: string;
	action?: React.ReactNode;
}) {
	return (
		<div className="flex min-h-80 flex-col items-center justify-center text-center">
			<span className="flex size-11 items-center justify-center rounded-2xl border bg-background text-muted-foreground [&_svg]:size-5">
				{icon}
			</span>
			<p className="mt-4 font-medium">{title}</p>
			<p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
				{body}
			</p>
			{action ? <div className="mt-4">{action}</div> : null}
		</div>
	);
}

function messageFor(error: unknown) {
	return error instanceof DemoChatError
		? error.message
		: "The demo chat could not continue. Try again.";
}
