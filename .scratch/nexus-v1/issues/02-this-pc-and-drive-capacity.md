# 02 — This PC Navigation & Storage Visualization

**What to build:**
A unified "This PC" (`nexus://this-pc`) virtual view displaying collapsible sidebar tree navigation, Quick Access folders (Desktop, Downloads, Documents, Pictures, Music, Videos), and interactive drive cards with real-time remaining capacity and colored progress bars (>90% turns red).

**Blocked by:**
None — can start immediately.

**Status:** ready-for-agent

- [x] Sidebar "This PC" section can be expanded/collapsed and lists all active drives with free space labels (e.g. `245 GB free`).
- [x] Navigating to `nexus://this-pc` renders folder shortcut cards and drive volume cards.
- [x] Drive volume cards calculate used percentage with dynamic progress fill turning red when usage exceeds 90%.
- [x] Clicking any drive card or sidebar drive item navigates directly to the volume root.
- [x] Breadcrumb and tab headers correctly display "This PC" / "本機" localized titles.
