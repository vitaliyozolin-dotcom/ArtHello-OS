export const INLINE_HELP_SUPPRESSION_SELECTOR = '[data-ah-inline-help="off"]';

type ClosestLookup = {
  closest: (selector: string) => unknown;
};

export function inlineHelpAllowed(element: ClosestLookup) {
  return !element.closest(INLINE_HELP_SUPPRESSION_SELECTOR);
}
