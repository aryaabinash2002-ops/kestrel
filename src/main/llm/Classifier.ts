import type { QuestionType } from '@shared/types/session';
import type { Settings } from '@shared/types/settings';
import { DEFAULT_PROMPTS } from '../prompts';
import type { LLMService } from './LLMService';

export interface Classification {
  is_question: boolean;
  question: string;
  type: QuestionType;
}

export const CLASSIFIER_SCHEMA = {
  type: 'object',
  properties: {
    is_question: { type: 'boolean' },
    question: { type: 'string' },
    type: {
      type: 'string',
      enum: [
        'behavioral',
        'technical',
        'system_design',
        'coding',
        'situational',
        'smalltalk',
        'factual',
        'sales',
        'puzzle',
        'product',
        'other',
      ],
    },
  },
  required: ['is_question', 'question', 'type'],
  additionalProperties: false,
} as const;

/** Small JSON classifier that runs in parallel with the answer (never on its critical path). */
export class Classifier {
  constructor(
    private llm: LLMService,
    private getSettings: () => Settings,
  ) {}

  async classify(
    fragment: string,
    context: string[],
    signal?: AbortSignal,
  ): Promise<Classification> {
    const s = this.getSettings();
    const system = s.prompts.classifier ?? DEFAULT_PROMPTS.classifier;
    const user =
      (context.length ? `<previous_lines>\n${context.join('\n')}\n</previous_lines>\n` : '') +
      `<fragment>\n${fragment}\n</fragment>`;
    const out = await this.llm.json<Partial<Classification>>({
      model: s.models.classifier,
      system,
      user,
      schema: CLASSIFIER_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'question_classification',
      maxTokens: 200,
      signal,
    });
    return {
      is_question: !!out.is_question,
      question:
        typeof out.question === 'string' && out.question.trim() ? out.question.trim() : fragment,
      type: (out.type as QuestionType) ?? 'other',
    };
  }
}
