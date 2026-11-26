<!-- A pane header's "zoomed" badge (tmux zoom, SPEC-PARTE2 §3). -->
<span class="zoom-badge" data-testid="zoom-badge">zoomed</span>

<style>
  .zoom-badge {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 18px;
    padding: 0 7px;
    margin-right: var(--zoom-badge-gap, 0);
    border-radius: var(--radius-pill);
    background: var(--accent-soft);
    color: var(--accent-ink);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    animation: badge-in var(--spring-bouncy-ms) var(--spring-bouncy) both;
  }
  .zoom-badge::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; box-shadow: 0 0 6px currentColor; }
  @keyframes badge-in { from { opacity: 0; transform: scale(0.7); } }
</style>
