import { describe, expect, it } from 'vitest';
import { buildReviewSystemPrompt, DEFAULT_REVIEW_PROMPT, REVIEW_OUTPUT_CONTRACT } from '../../src/ai/reviewPrompt';
import { parseReviewVerdict } from '../../src/ai/autoReview';
import { loadSettings, setReviewPromptOverride } from '../../src/ai/settings';

describe('buildReviewSystemPrompt', () => {
  it('uses the built-in rubric when there is no override (null, undefined or blank)', () => {
    for (const o of [null, undefined, '', '   \n']) {
      expect(buildReviewSystemPrompt(o)).toBe(`${DEFAULT_REVIEW_PROMPT}\n\n${REVIEW_OUTPUT_CONTRACT}`);
    }
  });

  it('replaces the rubric with an override but always keeps the output contract', () => {
    const p = buildReviewSystemPrompt('  Only check the hole diameters.  ');
    expect(p.startsWith('Only check the hole diameters.')).toBe(true);
    expect(p).not.toContain(DEFAULT_REVIEW_PROMPT);
    expect(p.endsWith(REVIEW_OUTPUT_CONTRACT)).toBe(true);
  });

  it('the output contract lists exactly the verdict lines the automatic loop parses', () => {
    const lines = REVIEW_OUTPUT_CONTRACT.split('\n').filter(l => /^Verdict: /.test(l));
    expect(lines.map(parseReviewVerdict)).toEqual(['pass', 'minor', 'rework']);
  });
});

describe('setReviewPromptOverride', () => {
  it('defaults to null and stores / clears an override', () => {
    const base = loadSettings();
    expect(base.reviewPromptOverride).toBeNull();
    const custom = setReviewPromptOverride(base, 'Be strict about wall thickness.');
    expect(custom.reviewPromptOverride).toBe('Be strict about wall thickness.');
    expect(setReviewPromptOverride(custom, '   ').reviewPromptOverride).toBeNull();
    expect(setReviewPromptOverride(custom, null).reviewPromptOverride).toBeNull();
  });
});
