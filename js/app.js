import * as writer from './writer.js?r=2';
import * as player from './player.js?r=2';

let shown = null;
const homeTitle = document.title;
history.scrollRestoration = 'manual';

function route() {
  const link = location.hash.slice(1);
  if (link === shown) return;
  shown = link;
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

document.addEventListener('click', (e) => {
  const home = e.target.closest && e.target.closest('a[data-home]');
  if (!home || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  if (location.hash) history.pushState(null, '', location.pathname);
  route();
});

route();
