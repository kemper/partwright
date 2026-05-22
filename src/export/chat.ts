// AI chat transcript export. Renders a ChatMessage[] to a readable Markdown
// document and triggers a download. Complements the structured chat embedded
// in `.partwright.json` session exports (see exportSession): this is the
// human-friendly, shareable form for a single conversation.

import type { ChatMessage, PersistedToolCall, PersistedToolResult } from '../ai/types';
import { downloadBlob, getExportFilename } from './download';

function fmtTimestamp(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function roleHeading(msg: ChatMessage): string {
  if (msg.role === 'user') {
    // A user message carrying only tool results is the agent loop posting the
    // previous turn's results back — label it as such so the transcript reads
    // naturally instead of showing an empty "You" turn.
    const onlyToolResults = msg.blocks.length === 0 && (msg.toolResults?.length ?? 0) > 0;
    return onlyToolResults ? 'Tool results' : 'You';
  }
  if (msg.compacted) return 'Assistant (compaction summary)';
  return 'Assistant';
}

function renderToolCall(tc: PersistedToolCall): string {
  let input: string;
  try {
    input = JSON.stringify(tc.input, null, 2);
  } catch {
    input = String(tc.input);
  }
  return `**→ tool call: \`${tc.name}\`**\n\n\`\`\`json\n${input}\n\`\`\``;
}

function renderToolResult(tr: PersistedToolResult): string {
  const tag = tr.isError ? '⚠ tool error' : '← tool result';
  const parts = [`**${tag}**`];
  const body = tr.content?.trim();
  if (body) parts.push('```\n' + body + '\n```');
  if (tr.image) parts.push(`_[image returned${tr.image.label ? `: ${tr.image.label}` : ''}]_`);
  return parts.join('\n\n');
}

function renderMessage(msg: ChatMessage): string {
  const parts: string[] = [`### ${roleHeading(msg)}`];

  for (const block of msg.blocks) {
    if (block.type === 'text') {
      const text = block.text.trim();
      if (text) parts.push(text);
    } else if (block.type === 'image') {
      parts.push(`_[image${block.source.label ? `: ${block.source.label}` : ''}]_`);
    } else if (block.type === 'thinking') {
      const thinkingText = block.text.trim();
      if (thinkingText) parts.push(`<details>\n<summary>🧠 thinking</summary>\n\n${thinkingText}\n\n</details>`);
    } else {
      // Cross-provider review block: render the feedback with its
      // attribution so the transcript captures the second opinion.
      const reviewText = block.text.trim();
      parts.push(`**👁 review — ${block.provider}/${block.model}**${reviewText ? `\n\n${reviewText}` : ''}`);
    }
  }

  for (const tc of msg.toolCalls ?? []) parts.push(renderToolCall(tc));
  for (const tr of msg.toolResults ?? []) parts.push(renderToolResult(tr));

  if (msg.aborted) parts.push('_[stopped before completing]_');

  // A bubble with no visible content (e.g. an assistant turn that only fired
  // tool calls already rendered above) shouldn't print a dangling heading.
  if (parts.length === 1) parts.push('_(no text)_');

  return parts.join('\n\n');
}

/** Render a chat transcript to a Markdown string. */
function chatToMarkdown(messages: ChatMessage[], title: string): string {
  const header = [
    `# Chat — ${title}`,
    `_Exported ${fmtTimestamp(Date.now())} · ${messages.length} message${messages.length === 1 ? '' : 's'}_`,
  ].join('\n\n');

  const body = messages.map(renderMessage).join('\n\n---\n\n');
  return `${header}\n\n---\n\n${body}\n`;
}

/**
 * Export a chat transcript as a Markdown (`.md`) file download.
 * `sessionName` is used for the document title and filename; pass null for the
 * pre-session global chat. Returns false (no download) when there's nothing to
 * export.
 */
export function exportChatMarkdown(messages: ChatMessage[], sessionName: string | null): boolean {
  if (messages.length === 0) return false;
  const title = sessionName ?? 'Global chat';
  const md = chatToMarkdown(messages, title);
  const blob = new Blob([md], { type: 'text/markdown' });
  const filename = getExportFilename('md', `${sessionName ?? 'global'}-chat`);
  downloadBlob(blob, filename, 'Chat');
  return true;
}
