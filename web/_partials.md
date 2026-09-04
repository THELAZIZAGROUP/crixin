# Marketing-page partials reference

These pages share a header / footer / pricing block. The HTML files duplicate
the markup intentionally (no template engine in v0.1) — when the marketing site
moves to Astro / Next in v0.2+, factor these into components.

## Shared header

```html
<header class="site">
  <div class="wrap row">
    <div><span class="brand-mark">crixin<span class="tag">v0.1 · in development</span></span></div>
    <nav class="primary">
      <a href="/">Overview</a>
      <a href="/claude.html">Claude Code</a>
      <a href="/cursor.html">Cursor</a>
      <a href="/codex.html">Codex</a>
      <a href="https://github.com/THELAZIZAGROUP/crixin">GitHub</a>
    </nav>
  </div>
</header>
```

## Shared footer

```html
<footer class="site">
  <div class="wrap row">
    <div>© 2026 Crixin · MIT licensed.</div>
    <div>
      <a href="https://github.com/THELAZIZAGROUP/crixin">GitHub</a>
      ·
      <a href="https://crixin.com">Pitch</a>
      ·
      <a href="https://crixin-platform.vercel.app/pricing">Pricing</a>
    </div>
  </div>
</footer>
```

## Pricing block

Lives at the bottom of every page. Single source of truth: `docs/product/pricing.md`.
