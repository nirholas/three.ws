/**
 * ML Configuration for ONNX Runtime Web integration
 * Models are loaded from HuggingFace CDN via @xenova/transformers
 */

export interface ModelConfig {
  id: string;
  name: string;
  hfModel: string;
  size: number;
  priority: number;
  required: boolean;
  task: 'feature-extraction' | 'text-classification' | 'text2text-generation' | 'token-classification';
}

export const MODEL_CONFIGS: ModelConfig[] = [
  {
    id: 'embeddings',
    name: 'all-MiniLM-L6-v2',
    hfModel: 'Xenova/all-MiniLM-L6-v2',
    size: 23_000_000,
    priority: 1,
    required: true,
    task: 'feature-extraction',
  },
  {
    id: 'sentiment',
    name: 'DistilBERT-SST2',
    hfModel: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
    size: 65_000_000,
    priority: 2,
    required: false,
    task: 'text-classification',
  },
  {
    id: 'summarization',
    name: 'Flan-T5-base',
    hfModel: 'Xenova/flan-t5-base',
    size: 250_000_000,
    priority: 3,
    required: false,
    task: 'text2text-generation',
  },
  {
    id: 'ner',
    name: 'BERT-NER',
    hfModel: 'Xenova/bert-base-NER',
    size: 65_000_000,
    priority: 4,
    required: false,
    task: 'token-classification',
  },
];

export const ML_FEATURE_FLAGS = {
  semanticClustering: true,
  mlSentiment: true,
  summarization: true,
  mlNER: true,
  insightsPanel: true,
};

export const ML_THRESHOLDS = {
  semanticClusterThreshold: 0.75,
  minClustersForML: 5,
  maxTextsPerBatch: 20, // Reduced from 50 to prevent timeout
  modelLoadTimeoutMs: 30000,
  inferenceTimeoutMs: 45000, // Reduced - fail faster and fallback to Jaccard
  memoryBudgetMB: 200,
};

export function getModelConfig(modelId: string): ModelConfig | undefined {
  return MODEL_CONFIGS.find(m => m.id === modelId);
}

export function getRequiredModels(): ModelConfig[] {
  return MODEL_CONFIGS.filter(m => m.required);
}

export function getModelsByPriority(): ModelConfig[] {
  return [...MODEL_CONFIGS].sort((a, b) => a.priority - b.priority);
}
