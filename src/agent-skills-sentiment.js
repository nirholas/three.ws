
import { ACTION_TYPES } from './agent-protocol.js';

export function registerSentimentSkills(agentSkills) {
  agentSkills.register({
    name: 'analyze-sentiment',
    description: 'Analyzes the sentiment of a given text.',
    instruction: 'Determine if the provided text has a positive, negative, or neutral sentiment.',
    animationHint: 'think',
    voicePattern: 'Analyzing the sentiment of "{{text}}"...',
    mcpExposed: true,
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text to be analyzed.'
        },
      },
      required: ['text'],
    },
    handler: async (args, ctx) => {
      const { text } = args;

      if (!text) {
        return {
          success: false,
          output: 'No text provided for sentiment analysis.',
        };
      }

      try {
        const response = await fetch('/api/sentiment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });

        if (!response.ok) {
          throw new Error(`Sentiment API failed with status: ${response.status}`);
        }

        const { sentiment } = await response.json();

        ctx.protocol.emit({
          type: ACTION_TYPES.SENTIMENT_ANALYZED,
          payload: { text, sentiment },
          agentId: ctx.identity?.id || 'default',
        });

        return {
          success: true,
          output: `The sentiment of "${text}" is ${sentiment}.`,
          data: { text, sentiment },
        };
      } catch (error) {
        console.error('Sentiment analysis failed:', error);
        return {
          success: false,
          output: 'Failed to analyze sentiment.',
        };
      }
    },
  });
}
