# Fix sidebar theming + make TikTok connect optional

## 1. Make TikTok connection optional

**`src/pages/autopilot/steps.ts`** — change the `connect` step's `isComplete` from `(ctx) => ctx.isConnected` to `() => true`. This unlocks all downstream steps regardless of TikTok status. The Connect page still renders, still shows the connect/reconnect CTA, and `firstIncompleteStep` will now skip past connect to `upload` on first load.

**`src/pages/autopilot/steps/ConnectPage.tsx`** — add a small "Optional — you can connect later before publishing" helper line under the account row so users understand they can move on.

**Redirect rule** — keep the existing `useAutopilotStepGuard`; with connect always complete, deep links work and `/autopilot` → `/autopilot/upload` (first incomplete) on fresh accounts. We accept this; the user wanted connect non-blocking.

(Publish path already requires `isConnected` server-side in `publish-tiktok-due`, so making the wizard step optional is safe.)

## 2. Sidebar matches the dark app shell

The shadcn `Sidebar` reads `--sidebar` / `--sidebar-foreground` tokens. Currently `:root` sets them to light values (`oklch(0.984 …)` bg, near-black text), and the app never adds the `.dark` class to `<html>`, so the sidebar renders white while the rest of the app is painted dark by the custom `app-shell` / `wizard-shell` rules from `styles.css`.

Two-line fix in **`src/styles.css`** `:root` block (around lines 90–97): override the sidebar tokens to match the app's dark surface tokens already defined elsewhere in the file:

```
--sidebar: oklch(0.16 0.02 270);              /* same family as --bg-base #0a0a0f */
--sidebar-foreground: oklch(0.98 0 0);        /* white */
--sidebar-primary: oklch(0.58 0.20 290);      /* accent purple */
--sidebar-primary-foreground: oklch(0.98 0 0);
--sidebar-accent: oklch(0.22 0.03 270);       /* hover row */
--sidebar-accent-foreground: oklch(0.98 0 0);
--sidebar-border: oklch(1 0 0 / 8%);
--sidebar-ring: oklch(0.58 0.20 290);
```

**`src/components/AppSidebar.tsx`** — drop the hard-coded `hover:bg-muted/50` on the `NavLink` (it fights the sidebar tokens) and let `SidebarMenuButton`'s built-in hover state do the work. Also style the `.brand-block` wordmark to use `text-sidebar-foreground`.

## 3. Verification

- `/autopilot/connect` — "Continue" enabled even when TikTok is not connected; step pills 2-5 no longer `aria-disabled`.
- Sidebar background is the same near-black as the main canvas; "FanAgent" wordmark and all nav items render white; active item uses the purple accent; hover row is a subtle lighter band.
- No regression on `/clips`, `/library`, `/campaigns` — sidebar tokens are the only CSS touched.

## Files

- edit `src/pages/autopilot/steps.ts`
- edit `src/pages/autopilot/steps/ConnectPage.tsx`
- edit `src/styles.css` (sidebar token block only)
- edit `src/components/AppSidebar.tsx`
