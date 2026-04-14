import { Strategy } from "../types";

type ChatHistoryEntry = {
  role: "user" | "model";
  parts: { text: string }[];
};

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload as T;
}

export const generateStrategies = async (userInstruction?: string, count = 5): Promise<Strategy[]> => {
  const response = await fetch("/api/ai/strategies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userInstruction, count }),
  });

  return parseJsonResponse<Strategy[]>(response);
};

export const analyzeStrategyDeepDive = async (strategy: Strategy): Promise<string> => {
  const response = await fetch("/api/ai/deep-dive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategy }),
  });

  const payload = await parseJsonResponse<{ content: string }>(response);
  return payload.content;
};

export const chatWithResearcher = async (history: ChatHistoryEntry[], message: string): Promise<string> => {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history, message }),
  });

  const payload = await parseJsonResponse<{ content: string }>(response);
  return payload.content;
};
