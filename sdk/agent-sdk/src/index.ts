export class Agent {
  private apiKey: string;
  private agentId: string;

  constructor(apiKey: string, agentId: string) {
    this.apiKey = apiKey;
    this.agentId = agentId;
  }

  async chat(message: string, history: { role: 'user' | 'assistant', content: string }[] = []): Promise<AsyncIterable<any>> {
    const response = await fetch('https://three.ws/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        agentId: this.agentId,
        message,
        history,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Chat API request failed: ${response.status} ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body from chat API');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    return {
      [Symbol.asyncIterator]: () => ({
        async next() {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (buffer.length > 0) {
                try {
                  return { value: JSON.parse(buffer), done: false };
                } catch (e) {
                  // ignore partial JSON at the end
                }
              }
              return { done: true, value: undefined };
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const json = line.slice(6);
                try {
                  return { value: JSON.parse(json), done: false };
                } catch (e) {
                  // ignore partial JSON
                }
              }
            }
          }
        }
      })
    };
  }

  embed(element: HTMLElement) {
    const iframe = document.createElement('iframe');
    iframe.src = `https://three.ws/agent/${this.agentId}/embed`;
    iframe.width = '100%';
    iframe.height = '100%';
    iframe.style.border = 'none';
    element.appendChild(iframe);
  }
}

export function createAgent(apiKey: string, agentId: string): Agent {
  return new Agent(apiKey, agentId);
}
