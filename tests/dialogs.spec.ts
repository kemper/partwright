import { test, expect } from 'playwright/test';

// Golden-path coverage for the stackable confirm/prompt dialogs
// (src/ui/dialogs.ts) that replaced the native window.confirm / window.prompt.
// Exercised in a real browser via dynamic import — they manipulate document.body
// directly and resolve a promise on OK / Cancel / Escape / backdrop.

test.describe('confirm/prompt dialogs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('#ai-panel', { state: 'attached' });
  });

  test('confirmDialog resolves true on OK and false on Escape', async ({ page }) => {
    // OK button (the primary, last button in the footer) → true.
    const okResult = await page.evaluate(async () => {
      const { confirmDialog } = await import('/src/ui/dialogs.ts');
      const p = confirmDialog('Proceed?', { confirmLabel: 'Proceed' });
      await new Promise(r => requestAnimationFrame(r));
      const btns = document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button');
      btns[btns.length - 1].click(); // confirm
      return p;
    });
    expect(okResult).toBe(true);

    // Escape → false, and the overlay is torn down.
    const escResult = await page.evaluate(async () => {
      const { confirmDialog } = await import('/src/ui/dialogs.ts');
      const p = confirmDialog('Proceed?');
      await new Promise(r => requestAnimationFrame(r));
      // A real keydown originates from the focused element and bubbles, so the
      // dialog's capture-phase handler runs first — mirror that here.
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return p;
    });
    expect(escResult).toBe(false);
    expect(await page.locator('[role="dialog"]').count()).toBe(0);
  });

  test('promptDialog returns the typed value, or null on cancel', async ({ page }) => {
    const value = await page.evaluate(async () => {
      const { promptDialog } = await import('/src/ui/dialogs.ts');
      const p = promptDialog('Name:', { placeholder: 'Untitled' });
      await new Promise(r => requestAnimationFrame(r));
      const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
      input.value = '  Widget  ';
      const btns = document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button');
      btns[btns.length - 1].click(); // confirm
      return p;
    });
    expect(value).toBe('Widget'); // trimmed

    const cancelled = await page.evaluate(async () => {
      const { promptDialog } = await import('/src/ui/dialogs.ts');
      const p = promptDialog('Name:');
      await new Promise(r => requestAnimationFrame(r));
      const btns = document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button');
      btns[0].click(); // cancel (first button)
      return p;
    });
    expect(cancelled).toBeNull();
  });

  test('a confirm dialog stacks above an open modal without closing it', async ({ page }) => {
    // The reason these don't use createModalShell: a confirm raised from inside
    // a modal must not dismiss its parent. Open a shell modal, raise a confirm
    // on top, press Escape — only the confirm closes; the parent stays.
    const counts = await page.evaluate(async () => {
      const shell = await import('/src/ui/modalShell.ts');
      const { confirmDialog } = await import('/src/ui/dialogs.ts');
      const parent = shell.createModalShell({ title: 'Parent' });
      const p = confirmDialog('Nested?');
      await new Promise(r => requestAnimationFrame(r));
      const whileOpen = document.querySelectorAll('[role="dialog"]').length; // 2
      // Escape from the focused element (inside the confirm) bubbles up; the
      // confirm's capture handler stops it before the parent shell sees it.
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await p; // confirm resolved/closed
      const afterEsc = document.querySelectorAll('[role="dialog"]').length; // 1 (parent remains)
      parent.close();
      return { whileOpen, afterEsc };
    });
    expect(counts.whileOpen).toBe(2);
    expect(counts.afterEsc).toBe(1);
  });
});
