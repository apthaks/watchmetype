// Router: no hash → writing screen, hash → replay screen.

import * as writer from './writer.js';
import * as player from './player.js';

let shown = null;
const homeTitle = document.title;
history.scrollRestoration = 'manual';

function route() {
  const link = location.hash.slice(1);
  if (link === shown) return;
  shown = link;
  // Start a replay at the top, even after a long draft.
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (link) {
    writer.hide();
    document.title = 'watchmetype';
    player.show(link);
  } else {
    player.hide();
    document.title = homeTitle;
    writer.show();
  }
}

addEventListener('hashchange', route);
addEventListener('popstate', route);

// Links back to the writing screen switch in place instead of reloading.
document.addEventListener('click', (e) => {
  const home = e.target.closest && e.target.closest('a[data-home]');
  if (!home || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  if (location.hash) history.pushState(null, '', location.pathname);
  route();
});

route();
