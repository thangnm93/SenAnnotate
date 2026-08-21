// =============================================================================
// Colour picker
// =============================================================================
//
// Deliberately the thinnest file in the extension, because it is the only one the e2e
// suite cannot reach. `EyeDropper` opens browser chrome — Playwright cannot click it,
// and in headless it aborts before it draws. So everything that *can* be tested lives
// somewhere else: this returns a hex string or `null`, and the formatting, the storing
// and the rendering are all somebody else's job.
//
// It exists for the case the computed-style reader cannot answer. `readStyleSummary`
// already gives the text colour and the real background of any element by walking its
// ancestors — but where the background is a gradient, an image or a canvas it reports
// `image` and refuses to guess, because one swatch cannot honestly stand for one. That
// refusal is the gap this fills, and it is the whole reason it is worth a control.
// =============================================================================

/** Chrome 95+; the extension already requires 111, so the guard is for other browsers. */
interface EyeDropperApi {
  open(): Promise<{ sRGBHex: string }>;
}

declare global {
  interface Window {
    EyeDropper?: new () => EyeDropperApi;
  }
}

export function canPickColour(): boolean {
  return typeof window.EyeDropper === "function";
}

/**
 * Open the picker and return `#rrggbb`, or `null` if it was dismissed.
 *
 * Must be called straight out of a real click: the API requires transient activation,
 * and an `await` before it spends the gesture. `AbortError` is what a dismissal looks
 * like and is not an error worth reporting — pressing Escape out of a colour picker is
 * a decision, not a failure.
 */
export async function pickColour(): Promise<string | null> {
  const Picker = window.EyeDropper;
  if (!Picker) return null;

  try {
    const { sRGBHex } = await new Picker().open();
    return sRGBHex.toLowerCase();
  } catch {
    return null;
  }
}
