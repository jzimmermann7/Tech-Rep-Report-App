import { getAnthropicClient, NARRATIVE_MODEL } from "../anthropic/client";
import type { JobMetadata } from "../ingest/jobMetadata";
import type { ParsedTable } from "../ingest/parsers/types";
import type { ParsedRouter } from "../ingest/parsers/router";

const SYSTEM_PROMPT = `You are drafting a section of an internal turbine-component inspection report ("I&A Report") for Allied Power Group, a turbine parts repair company. The audience is the customer receiving their equipment back and the internal reviewer who will edit this draft before it ships.

Style: concise, factual, engineering register. Short declarative sentences driven by counts and measurements (e.g. "Twenty-four (24) of ninety-two (92) buckets exhibit a linear indication on the platform."). No marketing language, no filler, no apologies, no meta-commentary about being an AI. Do not invent specific findings, counts, or defect locations that are not present in the data you were given — if the data doesn't support a claim, state what is and isn't known instead of guessing.`;

interface DraftContext {
  metadata: JobMetadata;
  instruction?: string;
  previousDraft?: string;
}

function withInstructionSuffix(prompt: string, ctx: DraftContext): string {
  if (ctx.previousDraft && ctx.instruction) {
    return `${prompt}\n\nA previous draft of this section was:\n"""\n${ctx.previousDraft}\n"""\n\nRevise it per this instruction from the reviewer: "${ctx.instruction}"`;
  }
  return prompt;
}

function activeOpSummary(router: ParsedRouter): string {
  const active = router.operations.filter((o) => o.active);
  return active.map((o) => `- [${o.sequence}] ${o.label}${o.note ? `: ${o.note}` : ""}`).join("\n");
}

function tableSummary(table: ParsedTable): string {
  const lines = [
    `Source: ${table.sourceFile} (sheet "${table.sheetName}")`,
    `Sample size: ${table.sampleSize}${table.populationSize ? ` of ${table.populationSize}` : ""}`,
    `Out-of-spec count: ${table.outOfSpecCount ?? "not computed"}`,
    ...table.notes.map((n) => `Note: ${n}`),
  ];
  return lines.join("\n");
}

export async function draftFpiVisual(router: ParsedRouter, ctx: DraftContext, crackMapAvailable: boolean): Promise<string> {
  const fpiOps = router.operations.filter((o) => o.active && /NDT|FPI|penetrant/i.test(o.label));
  const fpiOpsSummary = fpiOps.map((o) => `- [${o.sequence}] ${o.label}${o.note ? `: ${o.note}` : ""}`).join("\n");
  const prompt = withInstructionSuffix(
    `Draft the "FPI & Visual Inspection Summary" section for job #${ctx.metadata.jobNumber} (${ctx.metadata.customer}, ${ctx.metadata.part}, qty ${ctx.metadata.quantity}).

Here are the active FPI/visual-inspection router operations for this job:
${fpiOpsSummary || "(none found)"}

${
  crackMapAvailable
    ? "A crack-map source was found for this job — assume zone-by-zone finding detail will be attached separately as its own exhibit; do not restate it here."
    : "IMPORTANT: no crack-map source file was found for this job, and the router text above is procedural (what inspection to perform), not a record of actual findings. Do NOT invent specific defect counts, zones, or bucket numbers. Instead, state that the FPI/visual inspection was performed per the procedure above, and note that zone-level findings require the crack-map documentation or a tech rep's written findings note, which were not available in this job folder for this draft.\n\n"
}Write 1-2 short paragraphs.`,
    ctx
  );
  return callClaude(prompt);
}

export async function draftRecommendedRepairs(router: ParsedRouter, ctx: DraftContext): Promise<string> {
  const prompt = withInstructionSuffix(
    `Draft the "Recommended Repairs" section for job #${ctx.metadata.jobNumber} (${ctx.metadata.customer}, ${ctx.metadata.part}, qty ${ctx.metadata.quantity}).

Here is the job's active repair-router operation sequence, in order:
${activeOpSummary(router) || "(none found)"}

Present this as a clear, ordered checklist of the repair process from prep through final shipment, in plain customer-facing language (not internal work-instruction jargon). Group closely related consecutive steps where it reads more naturally, but keep the sequence order.`,
    ctx
  );
  return callClaude(prompt);
}

export async function draftDimensionalSummary(
  tables: { heightDimForm?: ParsedTable; dovetailDimension?: ParsedTable; wallThickness?: ParsedTable },
  ctx: DraftContext
): Promise<string> {
  const sections = Object.entries(tables)
    .filter(([, t]) => t)
    .map(([name, t]) => `${name}:\n${tableSummary(t!)}`)
    .join("\n\n");
  const prompt = withInstructionSuffix(
    `Draft the "Dimensional Inspection Summary" section for job #${ctx.metadata.jobNumber} (${ctx.metadata.customer}, ${ctx.metadata.part}, qty ${ctx.metadata.quantity}).

Dimensional data collected:
${sections || "(no dimensional data available)"}

Summarize each dimensional check with a one-line pass/fail-style conclusion and the out-of-spec count, then close with an overall repairability statement based on the totals given. If a table only sampled part of the population, say so explicitly rather than implying full coverage.`,
    ctx
  );
  return callClaude(prompt);
}

export async function draftIaSummary(sectionDrafts: Record<string, string>, ctx: DraftContext): Promise<string> {
  const combined = Object.entries(sectionDrafts)
    .map(([id, text]) => `--- ${id} ---\n${text}`)
    .join("\n\n");
  const prompt = withInstructionSuffix(
    `Draft the "I&A Summary" section — a short narrative synthesis that opens the report — for job #${ctx.metadata.jobNumber} (${ctx.metadata.customer}, ${ctx.metadata.part}, qty ${ctx.metadata.quantity}).

The following sections have already been drafted elsewhere in the report; synthesize a brief (2-3 paragraph) overview from them rather than repeating their detail verbatim:
${combined}

Cover: what was received and inspected, the overall condition/findings at a high level, and whether the set is repairable. Do not introduce any facts not present in the sections above.`,
    ctx
  );
  return callClaude(prompt);
}

async function callClaude(userPrompt: string): Promise<string> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: NARRATIVE_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text : "";
}
