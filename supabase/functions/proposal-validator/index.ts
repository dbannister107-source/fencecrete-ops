// proposal-validator edge function
// Math-checks a Fencecrete proposal before send. Accepts either pasted text
// or a base64-encoded PDF. Uses Claude Sonnet (more careful with arithmetic
// than Haiku) to extract line items, recompute totals, and flag mismatches.
//
// Why: per memory, Matt has a 64.8% proposal math error rate. Each error is
// a margin leak — either we underbill the customer or quote too high and
// lose the deal. This is the highest-leverage check on the platform.
//
// Output: structured findings { passed, errors[], warnings[], extracted, recompute_summary }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const MODEL = 'claude-sonnet-4-5-20250929';  // Sonnet for math reliability

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_PROMPT = `You are the Fencecrete proposal math auditor. You receive a sales proposal (text or PDF) and must:

1. EXTRACT every line item: description, quantity, unit, unit_price, line_total
2. EXTRACT every adjustment: subtotal, mobilization, sales tax (8.25% in Texas), discount, GRAND TOTAL
3. RECOMPUTE every line: quantity × unit_price = line_total
4. RECOMPUTE the subtotal: sum of all line_totals
5. RECOMPUTE the tax: subtotal × 0.0825 (unless tax-exempt is noted)
6. RECOMPUTE the grand total: subtotal + mobilization + tax − discount
7. CHECK pricing reasonableness against Fencecrete's typical ranges:
   - Precast fence panels: $80–$180 per LF
   - Single Wythe brick masonry: $150–$300 per LF
   - Wrought iron: $60–$120 per LF
   - Mobilization: typically $500–$2,500 depending on scope
   - Permits/bonds: separate line items

8. CHECK arithmetic on linear footage if multiple sections are listed (e.g., 100 LF + 200 LF section = 300 LF total)

Return ONLY a JSON object with this exact schema (no markdown, no preamble):

{
  "passed": boolean,
  "summary": "one-sentence verdict",
  "line_items": [
    {"description": str, "qty": num, "unit": str, "unit_price": num, "stated_total": num, "computed_total": num, "match": bool, "note": str|null}
  ],
  "totals": {
    "stated_subtotal": num|null, "computed_subtotal": num,
    "stated_tax": num|null, "computed_tax": num,
    "stated_grand_total": num|null, "computed_grand_total": num,
    "subtotal_match": bool, "tax_match": bool, "grand_total_match": bool
  },
  "errors": [
    {"severity": "critical"|"warning", "location": str, "description": str, "suggested_fix": str}
  ],
  "pricing_review": [
    {"line": str, "per_lf": num|null, "in_range": bool, "note": str|null}
  ],
  "recompute_delta": num
}

A proposal PASSES only if: every line_total matches within $0.50, subtotal matches within $1.00, tax matches within $1.00, grand total matches within $1.00, and there are zero critical errors. Otherwise FAIL.

If the input is unreadable or doesn't appear to be a proposal, return passed=false with errors=[{severity:"critical",location:"input",description:"...",suggested_fix:"..."}].

Do NOT invent data. If a number is missing or unclear, set the field to null and add a warning explaining what's missing.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const body = await req.json();
    const { text, pdfBase64, filename } = body;

    if (!text && !pdfBase64) {
      return new Response(JSON.stringify({ error: 'Need either text or pdfBase64' }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    // Build content array — PDF goes as document block, text as plain text
    const userContent: any[] = [];
    if (pdfBase64) {
      userContent.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
      });
      userContent.push({
        type: 'text',
        text: `Audit this proposal${filename ? ` (${filename})` : ''}. Return JSON per the schema.`,
      });
    } else {
      userContent.push({
        type: 'text',
        text: `Audit this proposal text. Return JSON per the schema.\n\n<proposal>\n${text}\n</proposal>`,
      });
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!claudeRes.ok) {
      const t = await claudeRes.text();
      return new Response(JSON.stringify({ error: `Claude API: ${claudeRes.status} ${t}` }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const claudeData = await claudeRes.json();
    const raw = claudeData?.content?.[0]?.text || '';
    const usage = claudeData?.usage || {};

    // Strip code fences if Claude added them despite instructions
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '');
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      return new Response(JSON.stringify({
        error: 'Could not parse Claude response as JSON',
        raw,
        parse_error: String(parseErr),
      }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
    }

    return new Response(JSON.stringify({
      result: parsed,
      tokens_in: usage.input_tokens,
      tokens_out: usage.output_tokens,
      model: MODEL,
    }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
});
