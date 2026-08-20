// =============================================================================
// Composer — the popup you type the annotation into
// =============================================================================

import { ANNOTATION_KINDS, type AnnotationKind } from "../../shared/types";
import { h, icon, listen, takeFocus } from "./dom";

/**
 * The rows the composer *shows* — everything a retarget replaces, and nothing else.
 *
 * Split out from `ComposerData` because `initialComment` and `initialKind` are consumed
 * exactly once, in the constructor. A `setData` that accepted them would imply the
 * composer might reset the note and the chosen type on a retarget, which is the one
 * behaviour this feature promises it will never do. The split makes that guarantee
 * structural instead of something a reader has to verify inside `renderMeta`.
 */
export interface ComposerMeta {
  title: string;
  /** `src/components/Foo.vue:12:5`, when we could work it out. */
  source: string | null;
  /** `<App> <TheSidebar> <BaseButton>`. */
  components: string | null;
  props: string | null;
  selectedText?: string;
  elementCount?: number;
}

export interface ComposerData extends ComposerMeta {
  initialComment?: string;
  initialKind?: AnnotationKind;
  initialImages?: string[];
}

/** Which way to walk the DOM from the element the composer is currently about. */
export type RetargetDirection = "parent" | "child" | "previous" | "next";

export interface ComposerCallbacks {
  onSubmit(comment: string, kind: AnnotationKind, referenceImages: string[]): void;
  onCancel(): void;
  onScreenshot(): void;
  /**
   * Files the user pasted or picked. Encoding them is the orchestrator's job — this
   * layer draws, and does not know what a canvas is for.
   */
  onAttach(files: File[]): void;
  onDelete?(): void;
  /** Absent when retargeting does not apply — a saved note, text, or a multi-select. */
  onRetarget?(direction: RetargetDirection): void;
}

const WIDTH = 380;
const GAP = 12;
const EDGE = 12;

const RETARGET_CONTROLS: {
  direction: RetargetDirection;
  key: string;
  glyph: string;
  title: string;
}[] = [
  { direction: "parent", key: "ArrowUp", glyph: "↑", title: "Select the parent (↑)" },
  { direction: "child", key: "ArrowDown", glyph: "↓", title: "Select the first child (↓)" },
  { direction: "previous", key: "ArrowLeft", glyph: "←", title: "Previous sibling (←)" },
  { direction: "next", key: "ArrowRight", glyph: "→", title: "Next sibling (→)" },
];

/**
 * Ceiling on reference images per note.
 *
 * Not a storage limit — `fitToQuota` owns that. It is a "you are describing one change"
 * limit: past three pictures the note is a mood board, and the strip stops fitting
 * across a 380px card without wrapping into something that needs a scroller.
 *
 * Exported because the orchestrator both slices files down to the cap before paying to
 * encode them and writes the toast that names it. Spelling the number out in prose over
 * there would leave a message insisting on three in a file nobody opens when the strip
 * grows to four.
 */
export const MAX_REFERENCE_IMAGES = 3;

export class Composer {
  readonly element: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly teardown: Array<() => void> = [];
  private readonly kindButtons = new Map<AnnotationKind, HTMLButtonElement>();
  private readonly strip: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  /**
   * Where the card was first placed, kept rather than used once. `position()` decides
   * between below the element and flipped above it by measuring the card, and the card
   * changes height after that decision was taken — attaching an image grows it, and a
   * retarget rebuilds a taller meta block. Both have to re-clamp against the anchor the
   * first decision was made against, not against a `top` frozen when the card was shorter.
   */
  private readonly anchor: { left: number; top: number; right: number; bottom: number };
  private images: string[];
  private kind: AnnotationKind;
  /** Rebuilt whole on every retarget — see `renderMeta`. */
  private readonly meta: HTMLElement;
  private readonly callbacks: ComposerCallbacks;

  constructor(
    layer: HTMLElement,
    anchor: { left: number; top: number; right: number; bottom: number },
    data: ComposerData,
    callbacks: ComposerCallbacks,
  ) {
    this.callbacks = callbacks;
    this.anchor = anchor;
    this.kind = data.initialKind ?? "ui";
    this.images = [...(data.initialImages ?? [])];

    this.strip = h("div", { class: "composer__images" });
    this.fileInput = h("input", {
      class: "composer__file",
      attrs: { type: "file", accept: "image/*", multiple: "" },
      on: {
        change: () => {
          callbacks.onAttach([...(this.fileInput.files ?? [])]);
          // The same file twice in a row would not fire `change` without this.
          this.fileInput.value = "";
        },
      },
    });

    this.textarea = h("textarea", {
      class: "composer__input",
      attrs: {
        placeholder: "What should change here?",
        rows: "3",
        "aria-label": "Annotation comment",
      },
    });
    this.textarea.value = data.initialComment ?? "";

    for (const { value, label, hint } of ANNOTATION_KINDS) {
      this.kindButtons.set(
        value,
        h("button", {
          class: "kind-chip",
          title: hint,
          text: label,
          dataset: { kind: value },
          attrs: { "aria-pressed": String(value === this.kind) },
          on: { click: () => this.selectKind(value) },
        }),
      );
    }

    const kinds = h("div", { class: "composer__kinds" }, ...this.kindButtons.values());

    this.meta = h("div", { class: "composer__meta" });
    this.renderMeta(data);

    const submit = h(
      "button",
      { class: "button button--primary", on: { click: () => this.submit() } },
      h("span", { text: data.initialComment !== undefined ? "Save" : "Add note" }),
    );

    const footer = h(
      "div",
      { class: "card__footer" },
      h("span", { class: "hint", text: "⌘/Ctrl + Enter" }),
      h("span", { class: "spacer" }),
      this.callbacks.onDelete
        ? h(
            "button",
            {
              class: "button button--ghost button--danger",
              title: "Delete annotation",
              on: { click: () => this.callbacks.onDelete?.() },
            },
            icon("trash", 14),
          )
        : null,
      h(
        "button",
        {
          class: "button button--ghost",
          title: "Capture a screenshot of this element",
          on: { click: () => this.callbacks.onScreenshot() },
        },
        icon("camera", 14),
      ),
      h(
        "button",
        {
          class: "button button--ghost button--attach",
          title: "Attach a reference image — or just paste one",
          on: { click: () => this.fileInput.click() },
        },
        icon("image", 14),
      ),
      submit,
    );

    this.element = h(
      "div",
      { class: "card composer" },
      h(
        "div",
        { class: "card__header" },
        icon("pencil", 14),
        h("span", { class: "card__title", text: "Annotation" }),
        h(
          "button",
          {
            class: "icon-button",
            title: "Cancel (Esc)",
            on: { click: () => this.callbacks.onCancel() },
          },
          icon("close", 14),
        ),
      ),
      h("div", { class: "card__body" }, this.meta, kinds, this.textarea, this.strip, this.fileInput),
      footer,
    );

    this.renderImages();

    layer.append(this.element);
    this.position(anchor);

    this.teardown.push(
      listen(this.element, "keydown", (event) => {
        const keyboard = event as KeyboardEvent;

        // An IME candidate window owns the keyboard while it is open, and its keystrokes
        // arrive here as ordinary `keydown`s. This guard is first so it covers Escape as
        // well as the arrows: with a Vietnamese, Japanese or Korean IME, cancelling a
        // composition would otherwise close the composer and drop the note, and picking a
        // candidate with the arrows would retarget instead — the pre-edit buffer is not in
        // `textarea.value`, so the "note is still empty" test below cannot see it.
        if (keyboard.isComposing) return;

        if (keyboard.key === "Escape") {
          keyboard.preventDefault();
          keyboard.stopPropagation();
          this.callbacks.onCancel();
        }
        if (keyboard.key === "Enter" && (keyboard.metaKey || keyboard.ctrlKey)) {
          keyboard.preventDefault();
          this.submit();
        }

        // Arrows retarget, but only while the note is still empty.
        //
        // The textarea takes focus the moment the composer opens, so from then on
        // the arrows belong to the caret — taking them outright would mean you
        // could not edit your own sentence. Empty is the honest signal that there
        // is no sentence yet, and it is also exactly when retargeting is wanted:
        // you clicked, you can see the wrong element highlighted, you fix it, then
        // you write. Once there is text, the buttons remain.
        //
        // Trimmed, because `submit` is: a reflex tap on the space bar is invisible on
        // screen and would otherwise kill the keys for the rest of this composer's life
        // while `submit` still called the note empty and refused to save.
        if (!this.callbacks.onRetarget || this.textarea.value.trim().length > 0) return;
        if (keyboard.metaKey || keyboard.ctrlKey || keyboard.altKey || keyboard.shiftKey) return;

        const control = RETARGET_CONTROLS.find((entry) => entry.key === keyboard.key);
        if (!control) return;

        // Auto-repeat is not a series of decisions. Each step is a bridge round trip and a
        // rebuilt meta block, so a held key would fire ~30 of both a second and walk the
        // tree far past what anyone was reading — and at the top, where the walk runs out,
        // it would re-create the "Nothing there" toast on every frame, restarting its
        // entrance animation into a strobe. One press, one level; the key still scrolls
        // nothing, because the press is swallowed either way.
        if (keyboard.repeat) {
          keyboard.preventDefault();
          return;
        }

        // Without this the page scrolls under the composer on every press.
        keyboard.preventDefault();
        this.callbacks.onRetarget(control.direction);
      }),
    );

    // Paste is the point of this feature — a screenshot from another window, a Figma
    // frame, a competitor's page — and the file picker is only the fallback for an
    // image that is already on disk. It is listened for on the whole card rather than
    // on the textarea: an image on the clipboard is not text, so wherever the caret
    // happens to be is not information.
    this.teardown.push(
      listen(this.element, "paste", (event) => {
        // Containment first, and unconditionally. `ClipboardEvent` is `composed: true`,
        // so a paste in here reaches `document` retargeted to our host — and a page that
        // listens for `paste` there (every rich-text editor, chat box and drag-drop
        // uploader does) would receive the clipboard we were handed and act on it: the
        // confidential frame the user is pasting *into a review note* gets uploaded into
        // the application under review. `preventDefault` cannot stop that; it only
        // suppresses the browser's own insertion. Same shape as `docs/modal-click-leak/`,
        // with a much worse payload, and the reason this is not conditional on there
        // being an image: a pasted paragraph of text is no more the page's business.
        event.stopPropagation();

        const items = [...((event as ClipboardEvent).clipboardData?.items ?? [])];
        const files = items
          .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null);

        if (!files.length) return;

        // Cancel the default only when the image is the whole clipboard. A clipboard is
        // not one thing: a copy out of Figma — or Excel, Word, Preview — carries
        // `text/plain` beside the bitmap, and cancelling on sight of the image ate the
        // half of the paste the textarea was about to receive. A plain text paste never
        // reaches here at all.
        const hasText = items.some(
          (item) => item.kind === "string" && item.type === "text/plain",
        );
        if (!hasText) event.preventDefault();

        callbacks.onAttach(files);
      }),
    );

    // Keystrokes inside the composer must never reach the page's own shortcuts.
    for (const type of ["keydown", "keyup", "keypress"] as const) {
      this.teardown.push(listen(this.element, type, (event) => event.stopPropagation()));
    }

    takeFocus(this.textarea);
  }

  /** Put the caret back after something else — the markup editor — borrowed focus. */
  focus(): void {
    takeFocus(this.textarea);
  }

  /**
   * How many more images this note will take.
   *
   * Asked *before* the files are encoded: the cap is known up front, and a full-size
   * canvas per file that is going to be discarded anyway is the most expensive possible
   * way to find out there was no room.
   */
  referenceImageRoom(): number {
    return Math.max(0, MAX_REFERENCE_IMAGES - this.images.length);
  }

  /**
   * Hand back encoded images. Returns how many were kept, so the caller can say when
   * the cap swallowed some rather than leaving the user wondering.
   */
  addReferenceImages(uris: string[]): number {
    const kept = uris.slice(0, this.referenceImageRoom());
    this.images = [...this.images, ...kept];
    this.renderImages();
    // The strip is ~62px of card that was not there when `position()` last ran. A note
    // taken in the lower third of the viewport was placed to just fit, so without this
    // the footer — Save, camera, attach, delete — slides under the fold, and the card
    // sits in a layer with no scroller and no way to reach it.
    this.position(this.anchor);
    return kept.length;
  }

  private renderImages(): void {
    this.strip.replaceChildren(
      ...this.images.map((uri, index) => {
        const thumb = h("img", {
          class: "composer__thumb",
          attrs: { src: uri, alt: `Reference image ${index + 1}` },
        });

        return h(
          "div",
          { class: "composer__image" },
          thumb,
          h(
            "button",
            {
              class: "composer__image-remove",
              title: "Remove this image",
              on: {
                click: () => {
                  this.images = this.images.filter((_, at) => at !== index);
                  this.renderImages();
                },
              },
            },
            icon("close", 10),
          ),
        );
      }),
    );
  }

  private selectKind(kind: AnnotationKind): void {
    this.kind = kind;
    for (const [candidate, button] of this.kindButtons) {
      button.setAttribute("aria-pressed", String(candidate === kind));
    }
    // Picking a type is not finishing the note; put the caret back where it was.
    takeFocus(this.textarea);
  }

  private submit(): void {
    const comment = this.textarea.value.trim();
    if (!comment) {
      takeFocus(this.textarea);
      return;
    }
    this.callbacks.onSubmit(comment, this.kind, this.images);
  }

  /**
   * (Re)build the metadata block from a draft.
   *
   * Rebuilt wholesale rather than patched, because retargeting changes *which* rows
   * exist — a `<div>` with no component data has no Source or Component row, and the
   * `<BaseButton>` above it has both. Destroying and recreating the whole composer
   * would be simpler still and is not an option: it would take the note being typed
   * and the focus with it.
   */
  private renderMeta(data: ComposerMeta): void {
    this.meta.replaceChildren();

    const title = this.metaRow("Element", data.title);
    if (this.callbacks.onRetarget) title.append(this.retargetControls());
    this.meta.append(title);

    if (data.elementCount && data.elementCount > 1) {
      this.meta.append(this.metaRow("Selection", `${data.elementCount} elements`));
    }
    if (data.source) this.meta.append(this.metaRow("Source", data.source, true));
    if (data.components) this.meta.append(this.metaRow("Component", data.components));
    if (data.props) this.meta.append(this.metaRow("Props", data.props));
    if (data.selectedText) this.meta.append(this.metaRow("Text", `"${data.selectedText}"`));
  }

  /**
   * Buttons for the same four moves the arrow keys make.
   *
   * Not redundant with the keys: the keys only work while the note is still empty
   * (see the keydown handler), so once you have started typing and *then* notice the
   * wrong element is selected, these are the only way. They are also the only thing
   * on screen that says retargeting exists at all — the lesson `marquee-select/`
   * paid for.
   */
  private retargetControls(): HTMLElement {
    return h(
      "div",
      { class: "retarget" },
      ...RETARGET_CONTROLS.map(({ direction, glyph, title }) =>
        h("button", {
          class: "icon-button retarget__button",
          title,
          text: glyph,
          attrs: { "aria-label": title },
          on: {
            click: () => {
              this.callbacks.onRetarget?.(direction);
              // Not because the button took focus — `root.ts` cancels `mousedown` outside
              // text fields precisely so it cannot. This is the recovery path: a page's
              // focus trap may have pulled focus out from under the note, and `takeFocus`
              // is the one call that wins that race (`docs/modal-trap-refocus/`).
              takeFocus(this.textarea);
            },
          },
        }),
      ),
    );
  }

  /**
   * Swap in a new element's rows without disturbing what has been typed.
   *
   * The comment, the chosen kind, the caret and the focus all belong to the person
   * writing, not to the element being described — retargeting changes the subject of
   * the sentence, never the sentence. `ComposerMeta` rather than `ComposerData` is what
   * makes that a type error rather than a promise.
   *
   * Re-clamped afterwards, against the original anchor. `position` writes a fixed `top`,
   * and `.card` is `position: fixed` with `overflow: hidden` and no `max-height` — so a
   * retarget from a bare `<div>` onto a framework component adds Source, Component and
   * Props rows (~54px) and the card grows downward from a `top` that was clamped when it
   * was shorter, putting Save, the camera and delete below the viewport. Not repositioning
   * is about not *following the element*; it was never about refusing to stay on screen.
   */
  setData(meta: ComposerMeta): void {
    this.renderMeta(meta);
    this.position(this.anchor);
  }

  private metaRow(key: string, value: string, accent = false): HTMLElement {
    return h(
      "div",
      { class: "meta-row" },
      h("span", { class: "meta-row__key", text: key }),
      h("span", {
        class: accent ? "meta-row__value meta-row__value--accent" : "meta-row__value",
        text: value,
      }),
    );
  }

  /** Prefer below-right of the target, then flip and clamp to stay on screen. */
  private position(anchor: { left: number; top: number; right: number; bottom: number }): void {
    const height = this.element.offsetHeight || 260;

    let left = anchor.left;
    if (left + WIDTH > window.innerWidth - EDGE) left = window.innerWidth - WIDTH - EDGE;
    if (left < EDGE) left = EDGE;

    let top = anchor.bottom + GAP;
    if (top + height > window.innerHeight - EDGE) {
      const above = anchor.top - height - GAP;
      top = above >= EDGE ? above : Math.max(EDGE, window.innerHeight - height - EDGE);
    }

    this.element.style.left = `${left}px`;
    this.element.style.top = `${top}px`;
  }

  destroy(): void {
    for (const off of this.teardown) off();
    this.element.remove();
  }
}
