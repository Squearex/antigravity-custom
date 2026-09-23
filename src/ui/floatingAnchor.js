/**
 * SX Core - Floating UI Positioner
 * Perfectly positions popovers 10px above the chat input box while horizontally aligned to the trigger button.
 */
import { computePosition, offset, shift, flip, autoUpdate } from '@floating-ui/dom';

export function getPromptCardElement(anchorBtn) {
    const textarea = document.querySelector('[contenteditable="true"], textarea, [data-testid="chat-input"]');
    if (textarea) {
        const formOrCard = textarea.closest('form')
                        || textarea.closest('[class*="rounded-2xl"], [class*="rounded-3xl"], [class*="rounded-[calc"]')
                        || textarea.closest('.bg-card, [class*="border"]')
                        || textarea.parentElement?.parentElement;
        if (formOrCard) return formOrCard;
    }
    const container = document.querySelector('form')
                   || document.querySelector('[data-testid="chat-input-container"]');
    if (container) return container;
    return anchorBtn?.closest('.relative') || anchorBtn;
}

export function createVirtualAnchor(anchorBtn) {
    return {
        getBoundingClientRect() {
            const btnRect = anchorBtn.getBoundingClientRect();
            const cardEl = getPromptCardElement(anchorBtn);
            const cardRect = cardEl ? cardEl.getBoundingClientRect() : btnRect;

            return {
                x: btnRect.x,
                left: btnRect.left,
                right: btnRect.right,
                width: btnRect.width,
                y: cardRect.top,
                top: cardRect.top,
                bottom: cardRect.top,
                height: 0,
            };
        }
    };
}

/**
 * Attaches a popover cleanly above the prompt card.
 * Returns an unbind function that stops autoUpdate.
 */
export function attachPopoverAboveChat(anchorBtn, popoverEl, options = {}) {
    const virtualRef = createVirtualAnchor(anchorBtn);
    const placement = options.placement || 'top';
    const gap = options.gap ?? 10;

    popoverEl.style.position = 'fixed';
    popoverEl.style.bottom = 'auto';
    popoverEl.style.right = 'auto';

    const update = () => {
        if (!popoverEl.isConnected || !anchorBtn.isConnected) return;
        computePosition(virtualRef, popoverEl, {
            placement,
            middleware: [
                offset(gap),
                shift({ padding: 12 }),
                flip({ fallbackPlacements: ['top-start', 'top-end'] })
            ]
        }).then(({ x, y }) => {
            if (!popoverEl.isConnected) return;
            popoverEl.style.left = `${Math.round(x)}px`;
            popoverEl.style.top = `${Math.round(y)}px`;
        }).catch(() => {});
    };

    update();
    const cleanup = autoUpdate(anchorBtn, popoverEl, update);
    return cleanup;
}
