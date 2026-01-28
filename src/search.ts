/**
 * Search module for semantic similarity queries.
 *
 * Uses cosine similarity on pre-computed embeddings.
 * No ML inference - just vector math.
 */

import { EmbeddingEntry, extractTitle } from './data.js';

export interface SearchResult {
  path: string;
  title: string;
  score: number;
}

/**
 * Compute cosine similarity between two vectors.
 *
 * Returns a value between -1 and 1, where 1 is most similar.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);

  // Handle zero vectors
  if (denominator === 0) {
    return 0;
  }

  return dot / denominator;
}

/**
 * Find notes most similar to a query embedding.
 */
export function findSimilar(
  queryEmbedding: number[],
  entries: Map<string, EmbeddingEntry>,
  options: {
    limit: number;
    threshold: number;
    excludePath?: string; // Exclude this path from results (for search_similar)
  }
): SearchResult[] {
  const { limit, threshold, excludePath } = options;

  const results: SearchResult[] = [];

  for (const [notePath, entry] of entries) {
    // Skip the query note itself if provided
    if (excludePath && notePath === excludePath) {
      continue;
    }

    const score = cosineSimilarity(queryEmbedding, entry.embedding);

    // Only include results above threshold
    if (score >= threshold) {
      results.push({
        path: notePath,
        title: extractTitle(notePath),
        score: Math.round(score * 1000) / 1000, // Round to 3 decimal places
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Return top N results
  return results.slice(0, limit);
}

/**
 * Find notes similar to an existing note in the vault.
 */
export function findSimilarToNote(
  notePath: string,
  entries: Map<string, EmbeddingEntry>,
  options: {
    limit: number;
    threshold: number;
  }
): SearchResult[] | null {
  const entry = entries.get(notePath);

  if (!entry) {
    return null; // Note not found in index
  }

  return findSimilar(entry.embedding, entries, {
    ...options,
    excludePath: notePath, // Don't return the query note itself
  });
}
