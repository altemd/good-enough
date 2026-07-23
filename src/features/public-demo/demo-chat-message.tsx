import { Bot, Brain, CircleStop, TriangleAlert, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { Bubble, BubbleContent } from "#/components/ui/bubble";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "#/components/ui/marker";
import {
	Message,
	MessageAvatar,
	MessageContent,
	MessageFooter,
} from "#/components/ui/message";
import type { DemoChatRequestMessage } from "./demo-chat-transport";
import { ModelMarkdown } from "./model-markdown";

export interface DemoChatMessage extends DemoChatRequestMessage {
	id: number;
	reasoning: string;
	status: "complete" | "streaming" | "stopped" | "failed";
}

export function DemoChatMessageView({ message }: { message: DemoChatMessage }) {
	const isUser = message.role === "user";
	const [reasoningOpen, setReasoningOpen] = useState(
		message.status === "streaming",
	);

	useEffect(() => {
		setReasoningOpen(message.status === "streaming");
	}, [message.status]);

	return (
		<Message align={isUser ? "end" : "start"} className="gap-3">
			<MessageAvatar className="h-8 w-8 self-start rounded-xl border bg-background">
				{isUser ? <UserRound className="size-4" /> : <Bot className="size-4" />}
			</MessageAvatar>
			<MessageContent>
				<Bubble
					align={isUser ? "end" : "start"}
					variant={isUser ? "default" : "outline"}
					className="max-w-[85%]"
				>
					<BubbleContent className="rounded-2xl px-4 py-3 leading-6 shadow-xs">
						{message.reasoning ? (
							<Collapsible
								open={reasoningOpen}
								onOpenChange={setReasoningOpen}
								className="mb-3 rounded-xl border bg-muted/50 p-3"
							>
								<CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 font-medium">
									<Brain className="size-4" />
									Reasoning
								</CollapsibleTrigger>
								<CollapsibleContent keepMounted>
									<ModelMarkdown className="mt-2 text-muted-foreground">
										{message.reasoning}
									</ModelMarkdown>
								</CollapsibleContent>
							</Collapsible>
						) : null}
						{message.content ? (
							isUser ? (
								<p className="whitespace-pre-wrap">{message.content}</p>
							) : (
								<ModelMarkdown>{message.content}</ModelMarkdown>
							)
						) : message.status === "streaming" ? (
							<p>Waiting for response…</p>
						) : null}
					</BubbleContent>
				</Bubble>
				{message.status === "stopped" ? (
					<MessageFooter>
						<Marker>
							<MarkerIcon>
								<CircleStop />
							</MarkerIcon>
							<MarkerContent>Generation stopped.</MarkerContent>
						</Marker>
					</MessageFooter>
				) : null}
				{message.status === "failed" ? (
					<MessageFooter>
						<Marker className="text-destructive">
							<MarkerIcon>
								<TriangleAlert />
							</MarkerIcon>
							<MarkerContent>Generation failed.</MarkerContent>
						</Marker>
					</MessageFooter>
				) : null}
			</MessageContent>
		</Message>
	);
}
