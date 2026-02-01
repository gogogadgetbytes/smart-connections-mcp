/**
 * Embeddings module for computing text embeddings.
 *
 * Uses Transformers.js to run the same model Smart Connections uses
 * (TaylorAI/bge-micro-v2) locally. This enables text-based semantic search
 * without requiring a starting note.
 *
 * Design note: This module is structured to support both:
 * - Query-time embedding (search_by_text tool)
 * - Future index-time embedding (if we build our own indexer)
 */

import { pipeline, FeatureExtractionPipeline } from '@huggingface/transformers';
import { log } from './security.js';

// Default model - matches what Smart Connections uses
const DEFAULT_MODEL = 'TaylorAI/bge-micro-v2';

// Maximum query length (characters) to prevent abuse
const MAX_QUERY_LENGTH = 500;

/**
 * Embedder class wraps the Transformers.js pipeline.
 * Initialized once at startup, reused for all queries.
 */
export class Embedder {
  private pipeline: FeatureExtractionPipeline | null = null;
  private modelKey: string;
  private dimensions: number;
  private ready: boolean = false;

  constructor(modelKey: string = DEFAULT_MODEL, dimensions: number = 384) {
    this.modelKey = modelKey;
    this.dimensions = dimensions;
  }

  /**
   * Initialize the embedding pipeline.
   * Should be called at server startup (eager loading).
   *
   * First run will download the model (~50MB) from Hugging Face Hub.
   * Subsequent runs load from ~/.cache/huggingface/
   */
  async initialize(): Promise<void> {
    if (this.ready) {
      return;
    }

    log('INFO', 'embedder_loading', { model: this.modelKey });

    try {
      // Create the feature extraction pipeline
      // dtype: 'fp32' for accuracy, quantized: false for compatibility
      // Note: Type assertion needed due to complex union type from @huggingface/transformers
      this.pipeline = (await pipeline('feature-extraction', this.modelKey, {
        dtype: 'fp32',
      })) as unknown as FeatureExtractionPipeline;

      this.ready = true;
      log('INFO', 'embedder_ready', { model: this.modelKey });
    } catch (e) {
      log('ERROR', 'embedder_init_failed', { error: String(e) });
      throw new Error(`Failed to initialize embedder: ${e}`);
    }
  }

  /**
   * Check if the embedder is ready for use.
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Get the model key this embedder uses.
   */
  getModelKey(): string {
    return this.modelKey;
  }

  /**
   * Get the embedding dimensions.
   */
  getDimensions(): number {
    return this.dimensions;
  }

  /**
   * Compute embedding for a text query.
   *
   * @param text - The text to embed (max 500 chars)
   * @returns Embedding vector (384 dimensions for bge-micro-v2)
   */
  async embed(text: string): Promise<number[]> {
    if (!this.ready || !this.pipeline) {
      throw new Error('Embedder not initialized');
    }

    // Validate and truncate query
    const query = text.slice(0, MAX_QUERY_LENGTH).trim();
    if (!query) {
      throw new Error('Empty query text');
    }

    try {
      // Run the model with mean pooling and normalization
      // This matches how Smart Connections generates embeddings
      const result = await this.pipeline(query, {
        pooling: 'mean',
        normalize: true,
      });

      // Convert to plain array
      // result.data is a Float32Array or similar typed array
      const embedding = Array.from(result.data as Float32Array);

      // Validate dimensions
      if (embedding.length !== this.dimensions) {
        log('WARN', 'embedding_dimension_mismatch', {
          expected: this.dimensions,
          actual: embedding.length,
        });
      }

      return embedding;
    } catch (e) {
      log('ERROR', 'embed_failed', { error: String(e) });
      throw new Error(`Failed to compute embedding: ${e}`);
    }
  }
}

/**
 * Create and initialize an embedder for a given model.
 *
 * @param modelKey - Hugging Face model key (default: TaylorAI/bge-micro-v2)
 * @param dimensions - Expected embedding dimensions (default: 384)
 */
export async function createEmbedder(
  modelKey: string = DEFAULT_MODEL,
  dimensions: number = 384
): Promise<Embedder> {
  const embedder = new Embedder(modelKey, dimensions);
  await embedder.initialize();
  return embedder;
}
