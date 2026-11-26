// =============================================================================
// Annotation panel — the list, and the copy button that is the point of it all
// =============================================================================

import { formatSource } from "../../shared/output";
import {
  OUTPUT_DETAIL_OPTIONS,
  groupByPage,
  isDone,
  kindOf,
  type Annotation,
  type OutputDetailLevel,
} from "../../shared/types";
import { clear, dismissCard, h, icon } from "./dom";

/** What the list is showing. Panel-local: it is a view, not a stored preference. */
type Filter = "all" | "open" | "done";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
];

export interface PanelCallbacks {
  onClose(): void;
  onCopy(): void;
  onDownload(): void;
  onClearAll(): void;
  onSelect(annotation: Annotation): void;
  onToggleStatus(annotation: Annotation): void;
  onHoverChange(annotation: Annotation | null): void;
  onDetailChange(level: OutputDetailLevel): void;
}

export class Panel {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly select: HTMLSelectElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly callbacks: PanelCallbacks;

  private readonly summary: HTMLElement;
  private readonly filterButtons = new Map<Filter, HTMLButtonElement>();

  private filter: Filter = "all";
  /** Last arguments to `render`, replayed when the filter changes. */
  private annotations: Annotation[] = [];
  private detailLevel: OutputDetailLevel = "standard";

  constructor(layer: HTMLElement, callbacks: PanelCallbacks) {
    this.callbacks = callbacks;
    this.list = h("div", { class: "panel__list" });
    this.summary = h("div", { class: "capture-summary", style: { display: "none" } });

    this.select = h("select", {
      class: "select",
      title: "How much detail to include in the copied report",
      on: {
        change: () => callbacks.onDetailChange(this.select.value as OutputDetailLevel),
      },
    });
    for (const option of OUTPUT_DETAIL_OPTIONS) {
      const node = h("option", { text: `${option.label} — ${option.hint}` });
      node.value = option.value;
      this.select.append(node);
    }

    for (const { value, label } of FILTERS) {
      this.filterButtons.set(
        value,
        h("button", {
          class: "panel__filter-button",
          text: label,
          attrs: { "aria-pressed": String(value === this.filter) },
          on: { click: () => this.setFilter(value) },
        }),
      );
    }

    this.copyButton = h(
      "button",
      { class: "button button--primary", on: { click: () => callbacks.onCopy() } },
      icon("copy", 14),
      h("span", { text: "Copy report" }),
    );

    this.element = h(
      "div",
      { class: "card panel" },
      h(
        "div",
        { class: "card__header" },
        icon("list", 14),
        h("span", { class: "card__title", text: "Annotations" }),
        // Secondary actions live in the header, not the footer. The footer is 380px
        // minus padding and already holds a detail `<select>` whose widest option is
        // 215px of it; a third control there squeezed "Copy report" onto two lines.
        h(
          "button",
          {
            class: "icon-button",
            title: "Download the report as a .md file",
            on: { click: () => callbacks.onDownload() },
          },
          icon("download", 14),
        ),
        h(
          "button",
          {
            class: "icon-button",
            title: "Clear all annotations on this site",
            on: { click: () => callbacks.onClearAll() },
          },
          icon("trash", 14),
        ),
        h(
          "button",
          { class: "icon-button", title: "Close (A)", on: { click: () => callbacks.onClose() } },
          icon("close", 14),
        ),
      ),
      h(
        "div",
        { class: "card__body" },
        this.summary,
        h("div", { class: "panel__filter" }, ...this.filterButtons.values()),
        this.list,
      ),
      h(
        "div",
        { class: "card__footer" },
        this.select,
        h("span", { class: "spacer" }),
        this.copyButton,
      ),
    );

    // A panel closed and reopened inside the exit animation would otherwise leave two
    // in the layer — the old one still fading, the new one already live.
    for (const stale of layer.querySelectorAll('.panel[data-leaving="true"]')) stale.remove();

    layer.append(this.element);
  }

  private setFilter(filter: Filter): void {
    this.filter = filter;
    for (const [candidate, button] of this.filterButtons) {
      button.setAttribute("aria-pressed", String(candidate === filter));
    }
    this.render(this.annotations, this.detailLevel);
  }

  private visible(annotations: Annotation[]): Annotation[] {
    if (this.filter === "open") return annotations.filter((item) => !isDone(item));
    if (this.filter === "done") return annotations.filter((item) => isDone(item));
    return annotations;
  }

  render(annotations: Annotation[], detailLevel: OutputDetailLevel): void {
    this.annotations = annotations;
    this.detailLevel = detailLevel;
    this.select.value = detailLevel;
    this.copyButton.disabled = annotations.length === 0;

    clear(this.list);

    const shown = this.visible(annotations);

    if (!shown.length) {
      this.list.append(
        h("div", {
          class: "empty",
          text: annotations.length
            ? "Nothing in this filter."
            : "No annotations yet. Turn on inspect mode and click something.",
        }),
      );
      return;
    }

    // Numbered against the page's full list, not the filtered view: note 3 has to stay
    // note 3 in the report whatever the panel is currently showing. A heading appears
    // only once the list holds a page other than this one, so a single-page list looks as it did.
    const pages = groupByPage(annotations, location.pathname, location.pathname);
    const shownByPage = groupByPage(shown, location.pathname, location.pathname);
    const labelled = pages.length > 1 || pages[0].pathname !== location.pathname;
    for (const group of shownByPage) {
      if (labelled) {
        const here = group.pathname === location.pathname;
        this.list.append(
          h("div", {
            class: "panel__page",
            text: here ? `${group.pathname} · this page` : group.pathname,
            dataset: { here: String(here) },
          }),
        );
      }
      const pageList = pages.find((candidate) => candidate.pathname === group.pathname)?.annotations ?? [];
      this.appendEntries(group.annotations, pageList);
    }
  }

  private appendEntries(shown: Annotation[], pageList: Annotation[]): void {
    const { callbacks } = this;
    for (const annotation of shown) {
      const number = pageList.indexOf(annotation) + 1;
      const source = formatSource(annotation.source);
      const done = isDone(annotation);

      const body = h(
        "div",
        { class: "entry__body" },
        h("div", { class: "entry__element", text: annotation.element }),
        source ? h("div", { class: "entry__source", text: source }) : null,
        h("div", { class: "entry__comment", text: annotation.comment }),
      );

      const status = h(
        "button",
        {
          class: "entry__status",
          title: done ? "Mark as still open" : "Mark as done",
          attrs: { "aria-pressed": String(done) },
          on: {
            click: (event) => {
              // The row itself scrolls to the element and opens the editor; ticking
              // a box must not also do that.
              event.stopPropagation();
              callbacks.onToggleStatus(annotation);
            },
          },
        },
        icon("check", 12),
      );

      this.list.append(
        h(
          "div",
          {
            class: "entry",
            dataset: { kind: kindOf(annotation), done: String(done) },
            on: {
              click: () => callbacks.onSelect(annotation),
              mouseenter: () => callbacks.onHoverChange(annotation),
              mouseleave: () => callbacks.onHoverChange(null),
            },
          },
          h("span", { class: "entry__number", text: String(number) }),
          body,
          status,
        ),
      );
    }
  }

  /**
   * Show what the extension has collected in the background. Testers need to see
   * that errors were captured *before* they hit copy, otherwise they have no way
   * of knowing the report contains anything beyond their own notes.
   */
  renderCaptureSummary(counts: { logs: number; requests: number; actions: number }): void {
    const parts: string[] = [];
    if (counts.logs) parts.push(`${counts.logs} console error${counts.logs === 1 ? "" : "s"}`);
    if (counts.requests) {
      parts.push(`${counts.requests} failed request${counts.requests === 1 ? "" : "s"}`);
    }
    if (counts.actions) parts.push(`${counts.actions} step${counts.actions === 1 ? "" : "s"}`);

    if (!parts.length) {
      this.summary.style.display = "none";
      return;
    }

    this.summary.style.display = "flex";
    this.summary.replaceChildren(
      icon("bug", 13),
      h("span", { text: `Captured: ${parts.join(" · ")}` }),
    );
    this.summary.title = "Included automatically when you copy the report";
  }

  destroy(): void {
    dismissCard(this.element);
  }
}
