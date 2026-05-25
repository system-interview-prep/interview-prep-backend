/**
 * Unwraps a "labeled JSON" tree where nodes may be { label, value }.
 * Returns a raw JSON structure (values only) for downstream logic (scoring/prompts).
 */
export function unwrapLabeledJson(input: any): any {
  const isLabeled =
    input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    Object.prototype.hasOwnProperty.call(input, 'value') &&
    Object.prototype.hasOwnProperty.call(input, 'label');

  if (isLabeled) {
    return unwrapLabeledJson((input as any).value);
  }

  if (Array.isArray(input)) {
    return input.map((x) => unwrapLabeledJson(x));
  }

  if (input && typeof input === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = unwrapLabeledJson(v);
    }
    return out;
  }

  return input;
}

