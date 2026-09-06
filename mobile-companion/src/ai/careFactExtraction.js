import { trustedDirectorySupabase } from '../cloud/trustedDirectoryVault';

// This adapter deliberately has no automatic caller. A future consented UI
// must ask before sending an excerpt, display the result as a suggestion, and
// validate it before it can affect any record.
export async function requestCareSuggestion({ operation, text, candidateFacts }) {
  if (!trustedDirectorySupabase) throw new Error('AI development provider is not configured.');
  if (!['extract', 'sufficiency'].includes(operation)) throw new Error('Unsupported AI operation.');
  const excerpt = typeof text === 'string' ? text.trim() : '';
  if (!excerpt || excerpt.length > 1200) throw new Error('Use a text excerpt between 1 and 1200 characters.');
  const { data, error } = await trustedDirectorySupabase.functions.invoke('extract-care-facts', {
    body: { operation, text: excerpt, ...(operation === 'sufficiency' ? { candidateFacts } : {}) },
  });
  if (error) throw error;
  if (!data?.suggestion) throw new Error('The AI provider returned an invalid suggestion.');
  return data.suggestion;
}
