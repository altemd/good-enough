import { Bot, Brain, UserRound } from "lucide-react";

import type { DemoChatRequestMessage } from "./demo-chat-transport";

export interface DemoChatMessage extends DemoChatRequestMessage {
	id: number;
	reasoning: string;
	status: "complete" | "streaming" | "stopped" | "failed";
}

export function DemoChatMessageView({ message }: { message: DemoChatMessage }) {
	const isUser = message.role === "user";
	return (
		<article className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
			<span className="flex size-8 shrink-0 items-center justify-center rounded-xl border bg-background">
				{isUser ? <UserRound className="size-4" /> : <Bot className="size-4" />}
			</span>
			<div
				className={`max-w-[85%] rounded-2xl border px-4 py-3 text-sm leading-6 shadow-xs ${
					isUser ? "bg-primary text-primary-foreground" : "bg-background"
				}`}
			>
				{message.reasoning ? (
					<details className="mb-3 rounded-xl border bg-muted/50 p-3 text-foreground">
						<summary className="flex cursor-pointer items-center gap-2 font-medium">
							<Brain className="size-4" />
							Reasoning
						</summary>
						<p className="mt-2 whitespace-pre-wrap text-muted-foreground">
							{message.reasoning}
						</p>
					</details>
				) : null}
				<p className="whitespace-pre-wrap">
					{message.content ||
						(message.status === "streaming" ? "Waiting for response…" : "")}
				</p>
				{message.status === "stopped" ? (
					<p className="mt-2 text-xs opacity-70">Generation stopped.</p>
				) : null}
				{message.status === "failed" ? (
					<p className="mt-2 text-xs text-destructive">Generation failed.</p>
				) : null}
			</div>
		</article>
	);
}
