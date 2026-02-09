export type ReceptionOutcome = "completed" | "handoff" | "fallback";

export interface ReceptionDecision {
  reply: string;
  confidence: number;
  outcome: ReceptionOutcome;
  driftScore: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function includesAny(input: string, patterns: string[]): boolean {
  return patterns.some((pattern) => input.includes(pattern));
}

export function estimateTokenCount(text: string): number {
  if (!text) {
    return 0;
  }

  return Math.max(1, Math.ceil(text.length / 4));
}

export function buildReceptionDecision(input: {
  businessName: string;
  customerMessage: string;
}): ReceptionDecision {
  const normalized = input.customerMessage.toLowerCase();

  if (
    includesAny(normalized, ["human", "agent", "person", "call me", "speak to someone"])
  ) {
    const confidence = 0.93;
    return {
      reply:
        "No problem ? a team member will reach out shortly. If helpful, send your address and best callback time.",
      confidence,
      outcome: "handoff",
      driftScore: clamp(1 - confidence + 0.02, 0, 1),
    };
  }

  if (includesAny(normalized, ["book", "schedule", "appointment", "tomorrow", "today"])) {
    const confidence = 0.88;
    return {
      reply:
        "Great ? please share preferred date/time and your service address. We will confirm the nearest available slot.",
      confidence,
      outcome: "completed",
      driftScore: clamp(1 - confidence, 0, 1),
    };
  }

  if (includesAny(normalized, ["quote", "price", "cost", "estimate", "how much"])) {
    const confidence = 0.86;
    return {
      reply:
        "Happy to help with a quote. Please send the service type, property size, and address and we will send pricing options.",
      confidence,
      outcome: "completed",
      driftScore: clamp(1 - confidence, 0, 1),
    };
  }

  if (includesAny(normalized, ["urgent", "asap", "emergency"])) {
    const confidence = 0.9;
    return {
      reply:
        "Understood ? this looks urgent. A team member will contact you right away. Please confirm your address.",
      confidence,
      outcome: "handoff",
      driftScore: clamp(1 - confidence + 0.025, 0, 1),
    };
  }

  const confidence = 0.7;
  return {
    reply: `Thanks for contacting ${input.businessName}. Please share your service need, address, and preferred time window so we can assist right away.`,
    confidence,
    outcome: "fallback",
    driftScore: clamp(1 - confidence + 0.01, 0, 1),
  };
}
