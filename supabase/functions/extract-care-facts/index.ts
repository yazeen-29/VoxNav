// Provider adapter for development only. It accepts only a small, explicitly
// submitted text excerpt and returns typed suggestions; it never stores the
// excerpt, and it is not allowed to give medical, financial, or emergency
// advice. `verify_jwt = true` in supabase/config.toml makes the gateway reject
// callers without a valid Supabase user JWT before this handler runs.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const factsSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['action', 'time', 'person', 'place', 'other'] },
          value: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['kind', 'value', 'confidence'],
      },
    },
    needs_human_review: { type: 'boolean' },
    caution: { type: 'string' },
  },
  required: ['facts', 'needs_human_review', 'caution'],
};

const sufficiencySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    sufficient: { type: 'boolean' },
    reason: { type: 'string' },
    next_fact_kind: { type: ['string', 'null'], enum: ['action', 'time', 'person', 'place', 'other', null] },
  },
  required: ['sufficient', 'reason', 'next_fact_kind'],
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  if (!request.headers.get('authorization')?.startsWith('Bearer ')) return response({ error: 'Authentication required' }, 401);

  let input: { operation?: string; text?: string; candidateFacts?: unknown };
  try { input = await request.json(); } catch { return response({ error: 'Invalid JSON' }, 400); }
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!['extract', 'sufficiency'].includes(input.operation || '') || !text || text.length > 1200) {
    return response({ error: 'Use a supported operation and a text excerpt of 1–1200 characters.' }, 400);
  }
  if (input.operation === 'sufficiency' && (!Array.isArray(input.candidateFacts) || input.candidateFacts.length > 5)) {
    return response({ error: 'Sufficiency checks need at most five candidate facts.' }, 400);
  }

  const apiKey = Deno.env.get('GROQ_API_KEY');
  if (!apiKey) return response({ error: 'AI development provider is not configured.' }, 503);
  const schema = input.operation === 'extract' ? factsSchema : sufficiencySchema;
  const system = input.operation === 'extract'
    ? 'Extract only explicit facts from the submitted text. Do not infer diagnoses, medication instructions, urgency, intent, or identity. Return no more than five facts. This is a suggestion for a human to review, never a decision.'
    : 'Decide only whether the supplied candidate facts are enough to explain the submitted text. Do not infer diagnoses, medication instructions, urgency, intent, or identity. This is a suggestion for a human to review, never a decision.';
  const user = input.operation === 'extract'
    ? `Submitted text:\n${text}`
    : `Submitted text:\n${text}\n\nCandidate facts (untrusted, review them):\n${JSON.stringify(input.candidateFacts)}`;

  try {
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: Deno.env.get('GROQ_MODEL') || 'openai/gpt-oss-20b',
        temperature: 0,
        max_completion_tokens: 500,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_schema', json_schema: { name: input.operation === 'extract' ? 'care_facts' : 'sufficiency', strict: true, schema } },
      }),
    });
    if (!upstream.ok) return response({ error: 'AI provider request failed. Try again later.' }, upstream.status === 429 ? 429 : 502);
    const result = await upstream.json();
    const content = result?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return response({ error: 'AI provider returned no structured result.' }, 502);
    const data = JSON.parse(content);
    // Keep post-provider bounds too; structured output controls shape, while
    // product limits control what reaches the mobile client.
    if (input.operation === 'extract' && (!Array.isArray(data?.facts) || data.facts.length > 5 || data.facts.some((fact: unknown) => typeof (fact as { value?: unknown })?.value !== 'string' || (fact as { value: string }).value.length > 180))) {
      return response({ error: 'AI provider returned an out-of-bounds suggestion.' }, 502);
    }
    return response({ operation: input.operation, suggestion: data });
  } catch {
    return response({ error: 'Could not complete the AI request.' }, 502);
  }
});
