
import { HfInference } from '@huggingface/inference';

const hf = new HfInference(process.env.HF_TOKEN);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { text } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Invalid input: "text" must be a non-empty string.' });
  }

  try {
    const result = await hf.textClassification({
      model: 'distilbert-base-uncased-finetuned-sst-2-english',
      inputs: text,
    });

    const positiveResult = result.find(item => item.label === 'POSITIVE');
    const sentiment = positiveResult && positiveResult.score > 0.6 ? 'Positive' : 'Negative';

    return res.status(200).json({ sentiment });
  } catch (error) {
    console.error('Error getting sentiment:', error);
    return res.status(500).json({ error: 'Failed to analyze sentiment.' });
  }
}
