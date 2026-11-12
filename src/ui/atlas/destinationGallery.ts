import { createIcon, nextDomId } from './components.js';

/** Authored orientation copy, separate from the registry's scientific fidelity labels. */
const DESTINATION_NOTES: Record<string, string> = {
  'black-hole': 'Follow light through curved spacetime.',
  'neutron-star': 'Meet the surface of an extreme star.',
  'stellar-explosion': 'Watch a star reshape its surroundings.',
  'compact-merger': 'Trace inspiral and post-merger evolution.',
  'tidal-disruption': 'Explore a star pulled apart by gravity.',
  'quasar-agn': 'Look inside an active galactic engine.',
  'black-hole-merger': 'Follow a merger from numerical-relativity data.',
  'galaxy-collision': 'See galaxies dance across cosmic time.'
};

/** Small original line-art symbols; decorative, never a simulation preview. */
export function createDestinationMark(id: string): HTMLElement {
  const mark = document.createElement('span');
  mark.className = 'atlas-orbit';
  mark.dataset.destination = id;
  mark.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) mark.append(document.createElement('i'));
  return mark;
}

export interface GalleryDestination {
  id: string;
  title: string;
  fidelity: string;
}

/** Pure UI: every selection goes through the shell's canonical host.navigate callback. */
export function createDestinationGallery(options: {
  destinations(): GalleryDestination[];
  activeId(): string;
  onSelect(id: string): void;
}): { root: HTMLDialogElement; open(): void; dispose(): void } {
  const root = document.createElement('dialog');
  root.className = 'atlas-gallery';
  const titleId = nextDomId('atlas-gallery-title');
  root.setAttribute('aria-labelledby', titleId);

  const head = document.createElement('div');
  head.className = 'atlas-gallery-head';
  const title = document.createElement('h1');
  title.id = titleId;
  title.textContent = 'Where to next?';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'atlas-btn atlas-btn--icon';
  close.setAttribute('aria-label', 'Close explorer');
  close.append(createIcon('close', 18));
  close.addEventListener('click', () => root.close());
  head.append(title, close);

  const searchRow = document.createElement('label');
  searchRow.className = 'atlas-gallery-search';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Find a destination…';
  search.setAttribute('aria-label', 'Find a destination');
  searchRow.append(createIcon('search', 18), search);

  const grid = document.createElement('div');
  grid.className = 'atlas-gallery-grid';
  const count = document.createElement('p');
  count.className = 'atlas-gallery-count';
  count.setAttribute('role', 'status');
  const empty = document.createElement('div');
  empty.className = 'atlas-gallery-empty';
  const emptyTitle = document.createElement('h2');
  emptyTitle.textContent = 'Uncharted territory.';
  const emptyCopy = document.createElement('p');
  emptyCopy.textContent = 'Try a star, a galaxy, or a black hole.';
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'atlas-btn atlas-btn--primary';
  clear.textContent = 'Show all destinations';
  clear.addEventListener('click', () => {
    search.value = '';
    render();
    search.focus();
  });
  empty.append(emptyTitle, emptyCopy, clear);

  function render(): void {
    const query = search.value.trim().toLocaleLowerCase();
    const destinations = options
      .destinations()
      .filter((entry) =>
        `${entry.title} ${DESTINATION_NOTES[entry.id] ?? ''} ${entry.fidelity.replaceAll('_', ' ')}`
          .toLocaleLowerCase()
          .includes(query)
      );
    grid.replaceChildren();
    for (const [index, entry] of destinations.entries()) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'atlas-destination-card';
      card.style.setProperty('--card-index', String(index));
      card.setAttribute('aria-label', `Visit ${entry.title}`);
      card.setAttribute('aria-pressed', String(entry.id === options.activeId()));
      const artwork = document.createElement('div');
      artwork.className = 'atlas-destination-art';
      artwork.append(createDestinationMark(entry.id));
      const name = document.createElement('strong');
      name.textContent = entry.title;
      const note = document.createElement('span');
      note.className = 'atlas-destination-note';
      note.id = nextDomId('atlas-destination-description');
      note.textContent = DESTINATION_NOTES[entry.id] ?? '';
      const fidelity = document.createElement('span');
      fidelity.className = 'atlas-destination-fidelity';
      fidelity.id = nextDomId('atlas-destination-fidelity');
      fidelity.textContent = entry.fidelity.replaceAll('_', ' ').toLocaleLowerCase();
      card.setAttribute('aria-describedby', `${note.id} ${fidelity.id}`);
      card.append(artwork, name, note, fidelity);
      card.addEventListener('click', () => {
        root.close();
        options.onSelect(entry.id);
      });
      grid.append(card);
    }
    empty.hidden = destinations.length !== 0;
    count.textContent = `${destinations.length} ${destinations.length === 1 ? 'destination' : 'destinations'}`;
  }
  search.addEventListener('input', render);
  root.addEventListener('keydown', (event) => {
    // Native search inputs consume the first Escape to clear their value.
    // A single Escape must dismiss this explorer from any focused control.
    if (event.key !== 'Escape') return;
    event.preventDefault();
    root.close();
  });
  root.addEventListener('click', (event) => {
    if (event.target !== root) return;
    const rect = root.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      root.close();
  });
  root.append(head, searchRow, count, grid, empty);
  return {
    root,
    open(): void {
      if (root.open) return;
      search.value = '';
      render();
      root.showModal();
      search.focus();
    },
    dispose(): void {
      root.close();
      root.remove();
    }
  };
}
