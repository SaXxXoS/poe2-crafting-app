(() => {
  'use strict';

  const $ = id => document.getElementById(id);

  const APP_DATA_ROOT = './generated/app-data';
  const PRICE_ITEMS = [
    'Orb of Transmutation',
    'Orb of Augmentation',
    'Regal Orb',
    'Exalted Orb',
    'Divine Orb',
    'Orb of Annulment',
    'Chaos Orb',
    'Vaal Orb'
  ];

  const CATEGORY_ORDER = ['weapon', 'armour', 'jewellery'];
  const CATEGORY_LABELS = {
    weapon: 'Waffe',
    armour: 'Rüstung',
    jewellery: 'Schmuck'
  };

  const CLASS_LABELS_DE = {
    'Amulet': 'Amulette',
    'Belt': 'Gürtel',
    'Body Armour': 'Körperrüstungen',
    'Boots': 'Stiefel',
    'Bow': 'Bögen',
    'Buckler': 'Faustschilde',
    'Claw': 'Klauen',
    'Crossbow': 'Armbrüste',
    'Dagger': 'Dolche',
    'Flail': 'Flegel',
    'Focus': 'Foki',
    'Gloves': 'Handschuhe',
    'Helmet': 'Helme',
    'Jewel': 'Juwelen',
    'One Hand Axe': 'Einhandäxte',
    'One Hand Mace': 'Einhandstreitkolben',
    'One Hand Sword': 'Einhandschwerter',
    'Quiver': 'Köcher',
    'Ring': 'Ringe',
    'Sceptre': 'Zepter',
    'Shield': 'Schilde',
    'Spear': 'Speere',
    'Staff': 'Stäbe',
    'Two Hand Axe': 'Zweihandäxte',
    'Two Hand Mace': 'Zweihandstreitkolben',
    'Two Hand Sword': 'Zweihandschwerter',
    'Wand': 'Zauberstäbe',
    'Warstaff': 'Kampfstäbe'
  };

  const PROPERTY_LABELS_DE = {
    attack_time: 'Angriffe pro Sekunde',
    critical_strike_chance: 'Kritische Trefferchance',
    physical_damage_min: 'Minimaler physischer Schaden',
    physical_damage_max: 'Maximaler physischer Schaden',
    range: 'Reichweite',
    armour: 'Rüstung',
    evasion: 'Ausweichwert',
    energy_shield: 'Energieschild',
    block: 'Blockchance',
    movement_speed: 'Bewegungsgeschwindigkeit'
  };

  const REQUIREMENT_LABELS_DE = {
    level: 'Stufe',
    strength: 'Stärke',
    dexterity: 'Geschick',
    intelligence: 'Intelligenz',
    str: 'Stärke',
    dex: 'Geschick',
    int: 'Intelligenz'
  };

  const state = {
    data: {
      ready: false,
      bases: [],
      basesById: new Map(),
      basesByClass: new Map(),
      classes: [],
      classById: new Map(),
      mods: [],
      modsById: new Map(),
      poolFiles: {},
      loadedPools: new Map()
    },
    prefix: [null, null, null],
    suffix: [null, null, null],
    activeType: null,
    activeIndex: null,
    scan: {
      file: null,
      objectUrl: null,
      rawText: '',
      recognizedMods: [],
      selectedModIds: new Set()
    }
  };

  async function fetchJson(url) {
    const response = await fetch(url, { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`${url} konnte nicht geladen werden (${response.status}).`);
    }

    return response.json();
  }

  function setDataStatus(message, type = '') {
    const element = $('dataStatus');
    if (!element) return;

    element.className = `status${type ? ` ${type}` : ''}`;
    element.textContent = message;
  }

  function normalizeText(value) {
    return String(value || '')
      .toLocaleLowerCase('de-DE')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9äöüß+%–-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function formatInternalName(value) {
    return String(value || '')
      .replace(/^Metadata\/Modifiers\//, '')
      .replace(/^stat_/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, character => character.toUpperCase())
      .trim();
  }

  function categoryForClass(itemClass) {
    const value = String(itemClass || '').toLowerCase();

    if (/(amulet|belt|ring|jewel|talisman)/.test(value)) return 'jewellery';
    if (/(armour|boots|buckler|focus|gloves|helmet|quiver|shield)/.test(value)) return 'armour';

    return 'weapon';
  }

  function propertyEntries(properties) {
    if (!properties || typeof properties !== 'object') return [];

    return Object.entries(properties)
      .map(([key, value]) => {
        if (value === null || value === undefined || value === '') return null;

        const normalizedKey = String(key).toLowerCase();
        const numericValue = Number(value);
        const label = PROPERTY_LABELS_DE[normalizedKey] || formatInternalName(key);

        if (normalizedKey === 'attack_time' && Number.isFinite(numericValue) && numericValue > 0) {
          return {
            label,
            value: (1000 / numericValue).toLocaleString('de-DE', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })
          };
        }

        if (normalizedKey === 'critical_strike_chance' && Number.isFinite(numericValue)) {
          return {
            label,
            value: `${(numericValue / 100).toLocaleString('de-DE', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            })} %`
          };
        }

        if (normalizedKey === 'block' && Number.isFinite(numericValue)) {
          const percent = numericValue > 100 ? numericValue / 100 : numericValue;
          return {
            label,
            value: `${percent.toLocaleString('de-DE', {
              maximumFractionDigits: 2
            })} %`
          };
        }

        if (typeof value === 'object') {
          return {
            label,
            value: JSON.stringify(value)
          };
        }

        return {
          label,
          value: Number.isFinite(numericValue)
            ? numericValue.toLocaleString('de-DE')
            : String(value)
        };
      })
      .filter(Boolean)
      .slice(0, 8);
  }

  function implicitEntries(base) {
    const implicits = Array.isArray(base.implicits) ? base.implicits : [];

    return implicits.map((implicit, index) => {
      if (typeof implicit === 'string') {
        return {
          id: implicit,
          name: formatInternalName(implicit),
          kind: 'Basis-Implizit'
        };
      }

      if (implicit && typeof implicit === 'object') {
        const id = implicit.id ?? implicit.mod_id ?? implicit.modId ?? `implicit-${index}`;
        return {
          id,
          name: implicit.name ?? implicit.text ?? formatInternalName(id),
          kind: implicit.type ?? 'Basis-Implizit'
        };
      }

      return {
        id: `implicit-${index}`,
        name: String(implicit),
        kind: 'Basis-Implizit'
      };
    });
  }

  function modDisplayName(mod) {
    if (mod.name) return mod.name;

    const statNames = (mod.stats || [])
      .map(stat => formatInternalName(stat.id))
      .filter(Boolean);

    if (statNames.length) return statNames.join(' + ');

    return formatInternalName(mod.id);
  }

  function modRange(mod) {
    const stats = Array.isArray(mod.stats) ? mod.stats : [];

    if (!stats.length) return 'Wertebereich nicht angegeben';

    return stats.map(stat => {
      const label = formatInternalName(stat.id);
      const min = Number(stat.min ?? 0);
      const max = Number(stat.max ?? min);
      const value = min === max ? String(min) : `${min}–${max}`;
      return `${label}: ${value}`;
    }).join(' · ');
  }

  function tierLabel(mod) {
    return mod.requiredLevel > 0
      ? `ab Item-Level ${mod.requiredLevel}`
      : 'ohne Mindeststufe';
  }

  function adaptMod(mod) {
    return {
      id: mod.id,
      name: modDisplayName(mod),
      range: modRange(mod),
      tier: tierLabel(mod),
      lvl: Number(mod.requiredLevel || 0),
      group: mod.group || mod.id,
      generationType: mod.generationType,
      spawnWeights: mod.spawnWeights || [],
      raw: mod
    };
  }

  function adaptBase(base) {
    const properties = propertyEntries(base.properties);

    return {
      ...base,
      name: base.nameDe || base.name || base.id,
      requiredLevel: Number(
        base.requirements?.level ??
        base.requirements?.Level ??
        base.dropLevel ??
        0
      ) || 0,
      requirements: formatRequirements(base.requirements),
      propertiesList: properties,
      implicitsDisplay: implicitEntries(base)
    };
  }

  function formatRequirements(requirements) {
    if (!requirements || typeof requirements !== 'object') return 'Keine';

    const rows = Object.entries(requirements)
      .filter(([, value]) =>
        value !== null &&
        value !== undefined &&
        value !== '' &&
        Number(value) !== 0
      )
      .map(([key, value]) => {
        const normalizedKey = String(key).toLowerCase();
        const label = REQUIREMENT_LABELS_DE[normalizedKey] || formatInternalName(key);
        return `${label} ${Number(value).toLocaleString('de-DE')}`;
      });

    return rows.join(' · ') || 'Keine';
  }

  function switchView(id) {
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    $(id).classList.add('active');

    document.querySelectorAll('.navbtn').forEach(button => {
      button.classList.toggle('active', button.dataset.view === id);
    });

    window.scrollTo({ top: 0, behavior: 'auto' });

    if (id === 'projects') renderProjects();
    if (id === 'database') renderDatabaseView();
  }

  function openSheet(id) {
    $(id).classList.add('open');
    $(id).setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function closeSheet(id) {
    $(id).classList.remove('open');
    $(id).setAttribute('aria-hidden', 'true');

    if (!document.querySelector('.sheet.open')) {
      document.body.classList.remove('modal-open');
    }
  }

  async function loadApplicationData() {
    setDataStatus('ExileForge-Datenbank wird geladen …');

    const [baseDocument, modDocument, indexDocument, manifest] = await Promise.all([
      fetchJson(`${APP_DATA_ROOT}/bases.json`),
      fetchJson(`${APP_DATA_ROOT}/mods.json`),
      fetchJson(`${APP_DATA_ROOT}/index.json`),
      fetchJson(`${APP_DATA_ROOT}/manifest.json`)
    ]);

    const bases = (baseDocument.bases || []).map(adaptBase);
    const mods = (modDocument.mods || []).map(adaptMod);
    const classes = indexDocument.classes || [];

    state.data.bases = bases;
    state.data.basesById = new Map(bases.map(base => [base.id, base]));
    state.data.mods = mods;
    state.data.modsById = new Map(mods.map(mod => [mod.id, mod]));
    state.data.classes = classes;
    state.data.classById = new Map(classes.map(itemClass => [itemClass.id, itemClass]));
    state.data.poolFiles = indexDocument.poolFiles || {};

    state.data.basesByClass = new Map();

    for (const base of bases) {
      if (!state.data.basesByClass.has(base.itemClass)) {
        state.data.basesByClass.set(base.itemClass, []);
      }

      state.data.basesByClass.get(base.itemClass).push(base);
    }

    state.data.ready = true;

    const counts = manifest.counts || {};
    setDataStatus(
      `${counts.equipmentBases ?? bases.length} Basen · ` +
      `${counts.referencedEquipmentMods ?? mods.length} Mods · ` +
      `${counts.poolFiles ?? Object.keys(state.data.poolFiles).length} Pool-Dateien`,
      'success'
    );
  }

  async function loadPool(itemClass) {
    if (state.data.loadedPools.has(itemClass)) {
      return state.data.loadedPools.get(itemClass);
    }

    const relativeFile = state.data.poolFiles[itemClass];

    if (!relativeFile) {
      const emptyPool = {};
      state.data.loadedPools.set(itemClass, emptyPool);
      return emptyPool;
    }

    const document = await fetchJson(`${APP_DATA_ROOT}/${relativeFile}`);
    const pools = document.pools || {};

    state.data.loadedPools.set(itemClass, pools);
    return pools;
  }

  function classOptionsForCategory(category) {
    return state.data.classes
      .filter(itemClass => categoryForClass(itemClass.id) === category)
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), 'de'));
  }

  async function renderClassOptions() {
    const category = $('category').value;
    const classes = classOptionsForCategory(category);
    const previous = $('itemClass').value;

    $('itemClass').innerHTML = classes
      .map(itemClass => `<option value="${itemClass.id}">${CLASS_LABELS_DE[itemClass.id] || itemClass.name || itemClass.id}</option>`)
      .join('');

    if (classes.some(itemClass => itemClass.id === previous)) {
      $('itemClass').value = previous;
    }

    await renderBaseOptions();
  }

  function currentBase() {
    const itemClass = $('itemClass').value;
    const list = state.data.basesByClass.get(itemClass) || [];
    const selectedId = $('basePicker').dataset.baseId;

    return list.find(base => base.id === selectedId) || list[0] || null;
  }

  async function renderBaseOptions() {
    const itemClass = $('itemClass').value;
    const list = state.data.basesByClass.get(itemClass) || [];

    if (list.length) {
      $('basePicker').disabled = false;
      $('basePicker').classList.remove('disabled');

      if (!list.some(base => base.id === $('basePicker').dataset.baseId)) {
        $('basePicker').dataset.baseId = list[0].id;
      }

      $('basePickerName').textContent = currentBase()?.name || '–';
    } else {
      $('basePicker').disabled = true;
      $('basePicker').classList.add('disabled');
      $('basePicker').dataset.baseId = '';
      $('basePickerName').textContent = 'Keine Basis vorhanden';
    }

    await loadPool(itemClass);
    renderBaseDetails();
    removeInvalidSelections();
    renderSlots();
  }

  function renderBaseDetails() {
    const base = currentBase();

    if (!base) {
      $('baseDetails').innerHTML = '<div class="status warn">Für diese Klasse wurden keine Basen gefunden.</div>';
      return;
    }

    const propertyCards = base.propertiesList.length
      ? base.propertiesList.map(property => `
          <div class="base-stat">
            <small>${property.label}</small>
            <b>${property.value}</b>
          </div>
        `).join('')
      : `
          <div class="base-stat">
            <small>Drop-Level</small>
            <b>${base.dropLevel}</b>
          </div>
          <div class="base-stat">
            <small>Größe</small>
            <b>${base.width || '–'} × ${base.height || '–'}</b>
          </div>
        `;

    const implicits = base.implicitsDisplay.map(implicit => `
      <div class="implicit">
        <span class="lock">🔒</span>
        <div>
          <b>${implicit.name}</b>
          <small>${implicit.kind} · belegt keinen Affix-Slot</small>
        </div>
      </div>
    `).join('');

    $('baseDetails').innerHTML = `
      <div class="base-title">
        <div>
          <h3>${base.name}</h3>
          <div class="base-subtitle">
            ${CLASS_LABELS_DE[base.itemClass] || base.itemClassName || base.itemClass} · Item-Level ${Number($('ilevel').value) || 1}
          </div>
        </div>
        <span class="verified">Live-Daten</span>
      </div>

      <div class="base-grid">
        ${propertyCards}
        <div class="base-stat">
          <small>Anforderungen</small>
          <b>${base.requirements}</b>
        </div>
        <div class="base-stat">
          <small>Drop-Level</small>
          <b>${base.dropLevel}</b>
        </div>
      </div>

      <div class="implicit-block">
        <div class="implicit-label">Eigenschaften der Basis</div>
        ${implicits || '<div class="status">Keine sichtbaren Basis-Implizits vorhanden.</div>'}
      </div>
    `;
  }

  function renderCurrentState() {
    const rarity = $('rarity').value;

    if (rarity === 'normal') {
      $('currentState').innerHTML =
        '<strong>Aktueller Gegenstand:</strong> Normale Basis · 0 Präfixe · 0 Suffixe.<br>' +
        '<span class="gold-text">Darunter wählst du trotzdem die Ziel-Affixe aus.</span>';
    } else if (rarity === 'magic') {
      $('currentState').innerHTML =
        '<strong>Aktueller Gegenstand:</strong> Magisch · höchstens 1 Präfix und 1 Suffix vorhanden.';
    } else {
      $('currentState').innerHTML =
        '<strong>Aktueller Gegenstand:</strong> Selten · vorhandene Affixe werden später als Ist-Zustand erfasst.';
    }
  }

  function slotLimit() {
    return $('targetRarity').value === 'magic' ? 1 : 3;
  }

  function trimForRarity() {
    const max = slotLimit();

    ['prefix', 'suffix'].forEach(type => {
      for (let index = max; index < 3; index += 1) {
        state[type][index] = null;
      }
    });
  }

  function removeInvalidSelections() {
    const itemLevel = Number($('ilevel').value) || 1;

    ['prefix', 'suffix'].forEach(type => {
      state[type] = state[type].map(mod =>
        mod && mod.lvl <= itemLevel ? mod : null
      );
    });
  }

  function renderSlots() {
    ['prefix', 'suffix'].forEach(type => {
      const host = $(`${type}Slots`);
      const max = slotLimit();
      host.innerHTML = '';

      for (let index = 0; index < 3; index += 1) {
        const mod = state[type][index];

        if (index >= max) {
          const disabled = document.createElement('button');
          disabled.type = 'button';
          disabled.className = 'affix-slot disabled';
          disabled.disabled = true;
          disabled.innerHTML = `
            <div class="meta">
              <small>${type === 'prefix' ? 'Präfix' : 'Suffix'} ${index + 1}</small>
              <b>Nicht verfügbar bei magischem Ziel</b>
            </div>
          `;
          host.appendChild(disabled);
          continue;
        }

        if (!mod) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'affix-slot';
          button.innerHTML = `
            <div class="meta">
              <small>${type === 'prefix' ? 'Präfix' : 'Suffix'} ${index + 1}</small>
              <b>➕ ${type === 'prefix' ? 'Präfix' : 'Suffix'} hinzufügen</b>
            </div>
            <div class="arrow">›</div>
          `;
          button.addEventListener('click', () => openModSheet(type, index));
          host.appendChild(button);
          continue;
        }

        const card = document.createElement('div');
        card.className = 'affix-card';

        const selectButton = document.createElement('button');
        selectButton.type = 'button';
        selectButton.className = 'affix-select';
        selectButton.innerHTML = `
          <div class="meta">
            <small>${type === 'prefix' ? 'Präfix' : 'Suffix'} ${index + 1} · ${mod.tier}</small>
            <b>${mod.name}</b>
          </div>
          <div class="arrow">›</div>
        `;
        selectButton.addEventListener('click', () => openModSheet(type, index));

        const range = document.createElement('div');
        range.className = 'affix-range';
        range.innerHTML = `<span>Möglicher Roll</span><strong>${mod.range}</strong>`;

        card.appendChild(selectButton);
        card.appendChild(range);
        host.appendChild(card);
      }

      $(`${type}Count`).textContent = `${state[type].filter(Boolean).length} / ${max}`;
    });
  }

  function openBaseSheet() {
    if ($('basePicker').disabled) return;

    const itemClass = state.data.classById.get($('itemClass').value);
    $('baseSheetHeading').textContent = `${CLASS_LABELS_DE[$('itemClass').value] || itemClass?.name || $('itemClass').value}: Basis auswählen`;
    $('baseSearch').value = '';
    renderBaseResults();
    openSheet('baseSheet');
  }

  function renderBaseResults() {
    const itemClass = $('itemClass').value;
    const query = normalizeText($('baseSearch').value);
    const list = (state.data.basesByClass.get(itemClass) || [])
      .filter(base => normalizeText(base.name).includes(query));

    $('baseResults').innerHTML = '';

    if (!list.length) {
      $('baseResults').innerHTML = '<div class="empty">Keine passende Basis gefunden.</div>';
      return;
    }

    list.forEach(base => {
      const row = document.createElement('div');
      row.className = 'result';

      const implicitText = base.implicitsDisplay
        .map(implicit => implicit.name)
        .join(' · ') || 'Keine sichtbare Basis-Eigenschaft';

      row.innerHTML = `
        <div>
          <b>${base.name}</b>
          <small>
            Drop-Level ${base.dropLevel} · ${CLASS_LABELS_DE[base.itemClass] || base.itemClassName || base.itemClass}<br>
            ${implicitText}
          </small>
        </div>
        <button class="add" type="button">Wählen</button>
      `;

      row.querySelector('button').addEventListener('click', () => {
        $('basePicker').dataset.baseId = base.id;
        $('basePickerName').textContent = base.name;
        state.prefix = [null, null, null];
        state.suffix = [null, null, null];
        renderBaseDetails();
        renderSlots();
        closeSheet('baseSheet');
      });

      $('baseResults').appendChild(row);
    });
  }

  async function poolForCurrentBase() {
    const base = currentBase();
    if (!base) return { p: [], s: [] };

    const pools = await loadPool(base.itemClass);
    return pools[base.id] || { p: [], s: [] };
  }

  async function openModSheet(type, index) {
    state.activeType = type;
    state.activeIndex = index;

    $('modSheetHeading').textContent =
      `${type === 'prefix' ? 'Präfix' : 'Suffix'} ${index + 1} auswählen`;
    $('modSearch').value = '';
    $('modResults').innerHTML = '<div class="empty">Mod-Pool wird geladen …</div>';

    openSheet('modSheet');
    await renderModResults();
  }

  async function availableMods() {
    const pool = await poolForCurrentBase();
    const rows = state.activeType === 'prefix' ? pool.p || [] : pool.s || [];
    const itemLevel = Number($('ilevel').value) || 1;
    const query = normalizeText($('modSearch').value);

    const current = state[state.activeType][state.activeIndex];
    const usedGroups = new Set(
      [...state.prefix, ...state.suffix]
        .filter(Boolean)
        .filter(mod => mod !== current)
        .map(mod => mod.group)
    );

    return rows
      .map(row => {
        const [modId, requiredLevel, spawnWeight] = row;
        const mod = state.data.modsById.get(modId);
        if (!mod) return null;

        return {
          ...mod,
          lvl: Number(requiredLevel ?? mod.lvl ?? 0),
          spawnWeight: Number(spawnWeight ?? 0)
        };
      })
      .filter(Boolean)
      .filter(mod => {
        const haystack = normalizeText(`${mod.name} ${mod.tier} ${mod.range} ${mod.group}`);

        return mod.lvl <= itemLevel &&
          !usedGroups.has(mod.group) &&
          (!query || haystack.includes(query));
      })
      .sort((a, b) =>
        a.lvl - b.lvl ||
        b.spawnWeight - a.spawnWeight ||
        a.name.localeCompare(b.name, 'de')
      );
  }

  async function renderModResults() {
    const type = state.activeType;
    const index = state.activeIndex;
    const selected = state[type][index];
    const list = await availableMods();

    $('modResults').innerHTML = '';

    if (selected) {
      const removeRow = document.createElement('div');
      removeRow.className = 'result';
      removeRow.innerHTML = `
        <div>
          <b>Ausgewählten Mod entfernen</b>
          <small>Slot wieder leeren</small>
        </div>
        <button class="add" type="button">Entfernen</button>
      `;

      removeRow.querySelector('button').addEventListener('click', () => {
        state[type][index] = null;
        renderSlots();
        closeSheet('modSheet');
      });

      $('modResults').appendChild(removeRow);
    }

    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Keine passenden Mods für diese Basis und dieses Item-Level gefunden.';
      $('modResults').appendChild(empty);
      return;
    }

    list.forEach(mod => {
      const row = document.createElement('div');
      row.className = 'result';
      const weightText = mod.spawnWeight > 0
        ? ` · Spawn-Gewicht ${mod.spawnWeight}`
        : '';

      row.innerHTML = `
        <div>
          <b>${mod.name}</b>
          <small>
            ${mod.tier}${weightText}<br>
            ${mod.range}
          </small>
        </div>
        <button class="add" type="button">Wählen</button>
      `;

      row.querySelector('button').addEventListener('click', () => {
        state[type][index] = mod;
        renderSlots();
        closeSheet('modSheet');
      });

      $('modResults').appendChild(row);
    });
  }

  function resetCraft() {
    state.prefix = [null, null, null];
    state.suffix = [null, null, null];
    renderSlots();
  }

  function saveProject() {
    const base = currentBase();

    const project = {
      itemClass: $('itemClass').value,
      baseId: base?.id || '',
      baseName: base?.name || '',
      ilevel: $('ilevel').value,
      rarity: $('rarity').value,
      targetRarity: $('targetRarity').value,
      budget: $('budget').value,
      strategy: $('strategy').value,
      prefix: state.prefix,
      suffix: state.suffix
    };

    localStorage.setItem('exileforge_project', JSON.stringify(project));
    updateHomeProject();
    alert('Crafting-Ziel wurde gespeichert.');
  }

  function updateHomeProject() {
    const project = JSON.parse(localStorage.getItem('exileforge_project') || 'null');

    $('homeProject').textContent = project
      ? `${project.baseName} · Item-Level ${project.ilevel}`
      : 'Noch kein Ziel gespeichert';

    $('homeProjectMeta').textContent = project
      ? `${project.itemClass} · ${project.strategy} · Budget ${project.budget} Divine`
      : 'Erstelle zuerst ein Crafting-Projekt.';
  }

  function renderProjects() {
    const project = JSON.parse(localStorage.getItem('exileforge_project') || 'null');

    $('projectList').innerHTML = project
      ? `
        <div class="card project">
          <div>
            <strong>${project.baseName}</strong>
            <small>${project.itemClass} · Item-Level ${project.ilevel} · ${project.strategy}</small>
          </div>
          <button id="editProjectBtn" class="secondary" type="button">Bearbeiten</button>
        </div>
      `
      : '<div class="card empty">Noch kein Projekt gespeichert.</div>';

    $('editProjectBtn')?.addEventListener('click', loadProject);
  }

  async function loadProject() {
    const project = JSON.parse(localStorage.getItem('exileforge_project') || 'null');
    if (!project) return;

    $('category').value = categoryForClass(project.itemClass);
    await renderClassOptions();

    $('itemClass').value = project.itemClass;
    await renderBaseOptions();

    $('basePicker').dataset.baseId = project.baseId;
    $('basePickerName').textContent = project.baseName;
    $('ilevel').value = project.ilevel;
    $('rarity').value = project.rarity;
    $('targetRarity').value = project.targetRarity;
    $('budget').value = project.budget;
    $('strategy').value = project.strategy;

    state.prefix = (project.prefix || [null, null, null])
      .map(mod => mod ? state.data.modsById.get(mod.id) || mod : null);
    state.suffix = (project.suffix || [null, null, null])
      .map(mod => mod ? state.data.modsById.get(mod.id) || mod : null);

    renderBaseDetails();
    renderCurrentState();
    renderSlots();
    switchView('craft');
  }

  function renderPrices() {
    const stored = JSON.parse(localStorage.getItem('exileforge_prices') || '{}');

    $('priceList').innerHTML = PRICE_ITEMS.map((name, index) => `
      <div class="price-row">
        <div>
          <strong>${name}</strong>
          <div class="muted-small">Wert in Exalted</div>
        </div>
        <input id="price${index}" type="number" step="0.01" value="${stored[name] ?? ''}" placeholder="–">
      </div>
    `).join('');
  }

  function savePrices() {
    const values = {};

    PRICE_ITEMS.forEach((name, index) => {
      const value = $(`price${index}`).value;
      if (value !== '') values[name] = Number(value);
    });

    localStorage.setItem('exileforge_prices', JSON.stringify(values));
    alert('Preise wurden lokal gespeichert.');
  }

  function renderDatabaseView() {
    const classes = state.data.classes.length;
    const bases = state.data.bases.length;
    const mods = state.data.mods.length;
    const loadedPools = state.data.loadedPools.size;

    $('databaseStats').innerHTML = `
      <div class="database-stat"><small>Basen</small><b>${bases}</b></div>
      <div class="database-stat"><small>Mods</small><b>${mods}</b></div>
      <div class="database-stat"><small>Klassen</small><b>${classes}</b></div>
      <div class="database-stat"><small>Geladene Pools</small><b>${loadedPools}</b></div>
    `;
  }

  function handleImage(input) {
    const file = input.files?.[0];
    if (file) startImageScan(file);
  }

  function resetScanView() {
    if (state.scan.objectUrl) URL.revokeObjectURL(state.scan.objectUrl);

    state.scan = {
      file: null,
      objectUrl: null,
      rawText: '',
      recognizedMods: [],
      selectedModIds: new Set()
    };

    $('scanPanel').hidden = true;
    $('scanResult').hidden = true;
    $('captureChoices').hidden = false;
    $('ocrProgressBar').style.width = '0%';
    $('ocrRawText').textContent = '';
    $('recognizedMods').innerHTML = '';
    populateRecognizedClasses($('itemClass').value);
    populateRecognizedBases($('itemClass').value);
    $('cameraInput').value = '';
    $('galleryInput').value = '';
  }

  function populateRecognizedClasses(selectedClass = '') {
    $('recognizedClass').innerHTML = state.data.classes
      .map(itemClass => `<option value="${itemClass.id}">${CLASS_LABELS_DE[itemClass.id] || itemClass.name || itemClass.id}</option>`)
      .join('');

    if (selectedClass && state.data.classById.has(selectedClass)) {
      $('recognizedClass').value = selectedClass;
    }
  }

  function populateRecognizedBases(itemClass, selectedId = '') {
    const bases = state.data.basesByClass.get(itemClass) || [];

    $('recognizedBase').innerHTML = bases.length
      ? bases.map(base => `<option value="${base.id}">${base.name}</option>`).join('')
      : '<option value="">Keine Basis vorhanden</option>';

    if (selectedId && bases.some(base => base.id === selectedId)) {
      $('recognizedBase').value = selectedId;
    }
  }

  function detectItemClass(rawText) {
    const normalized = normalizeText(rawText);
    let best = null;

    for (const itemClass of state.data.classes) {
      let score = 0;
      const className = normalizeText(itemClass.name || itemClass.id);

      if (className && normalized.includes(className)) {
        score += className.length + 20;
      }

      for (const baseId of itemClass.baseIds || []) {
        const base = state.data.basesById.get(baseId);
        const baseName = normalizeText(base?.name);

        if (baseName && normalized.includes(baseName)) {
          score += baseName.length + 100;
        }
      }

      if (!best || score > best.score) {
        best = { itemClass: itemClass.id, score };
      }
    }

    return best?.score > 0 ? best.itemClass : null;
  }

  function findRecognizedBase(rawText, itemClass) {
    const normalized = normalizeText(rawText);

    return (state.data.basesByClass.get(itemClass) || [])
      .slice()
      .sort((a, b) => b.name.length - a.name.length)
      .find(base => normalized.includes(normalizeText(base.name))) || null;
  }

  function findRecognizedItemLevel(rawText) {
    for (const pattern of [
      /gegenstandsstufe\s*[:\-]?\s*(\d{1,3})/i,
      /item\s*level\s*[:\-]?\s*(\d{1,3})/i,
      /\bilvl\s*[:\-]?\s*(\d{1,3})/i
    ]) {
      const match = rawText.match(pattern);
      if (match) return Math.min(100, Math.max(1, Number(match[1])));
    }

    return Number($('ilevel').value) || 1;
  }

  function tokenise(value) {
    return normalizeText(value)
      .split(' ')
      .filter(token => token.length >= 3 && !/^\d+$/.test(token));
  }

  function similarityScore(source, target) {
    const sourceTokens = new Set(tokenise(source));
    const targetTokens = new Set(tokenise(target));

    if (!sourceTokens.size || !targetTokens.size) return 0;

    let matches = 0;

    targetTokens.forEach(token => {
      if (sourceTokens.has(token)) {
        matches += 1;
      } else {
        const fuzzy = [...sourceTokens].some(sourceToken =>
          sourceToken.startsWith(token.slice(0, Math.max(4, token.length - 2))) ||
          token.startsWith(sourceToken.slice(0, Math.max(4, sourceToken.length - 2)))
        );

        if (fuzzy) matches += 0.65;
      }
    });

    return matches / targetTokens.size;
  }

  async function findRecognizedMods(rawText, itemClass, baseId) {
    const poolDocument = await loadPool(itemClass);
    const pool = poolDocument[baseId] || { p: [], s: [] };

    const lines = String(rawText || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length >= 4);

    const found = [];

    for (const [type, rows] of [['prefix', pool.p || []], ['suffix', pool.s || []]]) {
      for (const row of rows) {
        const mod = state.data.modsById.get(row[0]);
        if (!mod) continue;

        let bestScore = 0;
        let bestLine = '';

        for (const line of lines) {
          const score = similarityScore(line, `${mod.name} ${mod.range}`);

          if (score > bestScore) {
            bestScore = score;
            bestLine = line;
          }
        }

        if (bestScore >= 0.62) {
          const existing = found.find(item => item.mod.group === mod.group);

          if (!existing || bestScore > existing.confidence) {
            if (existing) found.splice(found.indexOf(existing), 1);

            found.push({
              type,
              mod,
              confidence: bestScore,
              sourceLine: bestLine
            });
          }
        }
      }
    }

    return found
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 6);
  }

  function renderRecognizedMods() {
    const host = $('recognizedMods');
    host.innerHTML = '';

    if (!state.scan.recognizedMods.length) {
      host.innerHTML = `
        <div class="status warn">
          Keine Affixe sicher erkannt. Basis und Item-Level können trotzdem übernommen werden.
        </div>
      `;
      return;
    }

    state.scan.selectedModIds = new Set(
      state.scan.recognizedMods
        .filter(item => item.confidence >= 0.7)
        .map(item => item.mod.id)
    );

    state.scan.recognizedMods.forEach(item => {
      const { type, mod, confidence, sourceLine } = item;
      const checked = state.scan.selectedModIds.has(mod.id);
      const row = document.createElement('label');

      row.className = 'recognized-mod';
      row.innerHTML = `
        <input type="checkbox" data-mod-id="${mod.id}" ${checked ? 'checked' : ''}>
        <span>
          <b>${mod.name}</b>
          <small>
            ${type === 'prefix' ? 'Präfix' : 'Suffix'} · ${mod.tier}<br>
            <span class="confidence">Erkennung ${Math.round(confidence * 100)} %</span>
            ${sourceLine ? ` · OCR-Zeile: ${sourceLine}` : ''}
          </small>
        </span>
      `;

      row.querySelector('input').addEventListener('change', event => {
        if (event.target.checked) state.scan.selectedModIds.add(mod.id);
        else state.scan.selectedModIds.delete(mod.id);
      });

      host.appendChild(row);
    });
  }

  function loadImageElement(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };

      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Bildformat konnte nicht gelesen werden.'));
      };

      image.src = url;
    });
  }

  async function prepareImageForOcr(file) {
    const image = await loadImageElement(file);
    const maxWidth = 1800;
    const scale = Math.min(1, maxWidth / image.naturalWidth);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);

    const imageData = context.getImageData(0, 0, width, height);
    const pixels = imageData.data;

    for (let index = 0; index < pixels.length; index += 4) {
      const luminance =
        pixels[index] * 0.299 +
        pixels[index + 1] * 0.587 +
        pixels[index + 2] * 0.114;

      const boosted = luminance > 150
        ? 255
        : luminance < 70
          ? 0
          : Math.min(255, luminance * 1.35);

      pixels[index] = boosted;
      pixels[index + 1] = boosted;
      pixels[index + 2] = boosted;
    }

    context.putImageData(imageData, 0, 0);

    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Bild konnte nicht für OCR vorbereitet werden.'));
      }, 'image/png', 0.95);
    });
  }

  async function runOcr(imageSource, language) {
    return Tesseract.recognize(imageSource, language, {
      logger(message) {
        if (message.status === 'recognizing text') {
          const percent = Math.round((message.progress || 0) * 100);
          $('ocrProgressBar').style.width = `${percent}%`;
          $('imageStatus').textContent = `Text wird erkannt … ${percent} %`;
        } else if (message.status) {
          $('imageStatus').textContent = `OCR: ${message.status}`;
        }
      }
    });
  }

  async function startImageScan(file) {
    if (!file) return;

    if (!window.Tesseract) {
      $('captureChoices').hidden = true;
      $('scanPanel').hidden = false;
      $('imageStatus').className = 'status warn';
      $('imageStatus').textContent =
        'OCR-Bibliothek konnte nicht geladen werden. Prüfe die Internetverbindung.';
      return;
    }

    if (state.scan.objectUrl) URL.revokeObjectURL(state.scan.objectUrl);

    state.scan.file = file;
    state.scan.objectUrl = URL.createObjectURL(file);
    $('imagePreview').src = state.scan.objectUrl;
    $('captureChoices').hidden = true;
    $('scanPanel').hidden = false;
    $('scanResult').hidden = true;
    $('ocrProgressBar').style.width = '2%';
    $('imageStatus').className = 'status';
    $('imageStatus').textContent = 'Bild wird für die Texterkennung vorbereitet …';

    try {
      let preparedImage;

      try {
        preparedImage = await prepareImageForOcr(file);
      } catch {
        preparedImage = file;
      }

      let result;

      try {
        result = await runOcr(preparedImage, 'deu+eng');
      } catch {
        $('imageStatus').textContent = 'Deutsche OCR fehlgeschlagen. Zweiter Versuch …';
        result = await runOcr(preparedImage, 'eng');
      }

      const rawText = result?.data?.text || '';
      state.scan.rawText = rawText;

      const detectedClass = detectItemClass(rawText) || $('itemClass').value;
      const recognizedBase = findRecognizedBase(rawText, detectedClass);
      const fallbackBase = recognizedBase ||
        (state.data.basesByClass.get(detectedClass) || [])[0] ||
        null;

      state.scan.recognizedMods = fallbackBase
        ? await findRecognizedMods(rawText, detectedClass, fallbackBase.id)
        : [];

      populateRecognizedClasses(detectedClass);
      populateRecognizedBases(detectedClass, fallbackBase?.id || '');

      $('recognizedItemLevel').value = findRecognizedItemLevel(rawText);
      $('ocrRawText').textContent = rawText || 'Kein Text erkannt.';

      renderRecognizedMods();

      $('ocrProgressBar').style.width = '100%';
      $('imageStatus').className = rawText.trim() ? 'status' : 'status warn';
      $('imageStatus').textContent = rawText.trim()
        ? `Erkennung abgeschlossen. ${state.scan.recognizedMods.length} mögliche Affixe gefunden.`
        : 'Kein verwertbarer Text erkannt. Fotografiere das Item näher und ohne Spiegelungen.';

      $('scanResult').hidden = false;
    } catch (error) {
      console.error('OCR failed', error);
      $('imageStatus').className = 'status warn';
      $('imageStatus').textContent =
        `Texterkennung fehlgeschlagen: ${error?.message || 'unbekannter Fehler'}`;
      $('ocrProgressBar').style.width = '0%';
      $('scanResult').hidden = false;
      $('ocrRawText').textContent = String(error?.stack || error?.message || error);
      state.scan.recognizedMods = [];
      state.scan.selectedModIds = new Set();
      renderRecognizedMods();
    }
  }

  async function applyScan() {
    const itemClass = $('recognizedClass').value;
    const category = categoryForClass(itemClass);
    const baseId = $('recognizedBase').value;
    const base = state.data.basesById.get(baseId);

    $('category').value = category;
    await renderClassOptions();
    $('itemClass').value = itemClass;
    await renderBaseOptions();

    if (base) {
      $('basePicker').dataset.baseId = base.id;
      $('basePickerName').textContent = base.name;
    }

    $('ilevel').value = Math.min(
      100,
      Math.max(1, Number($('recognizedItemLevel').value) || 1)
    );

    state.prefix = [null, null, null];
    state.suffix = [null, null, null];

    state.scan.recognizedMods
      .filter(item => state.scan.selectedModIds.has(item.mod.id))
      .forEach(({ type, mod }) => {
        const index = state[type].findIndex(value => !value);
        if (index >= 0 && index < 3) state[type][index] = mod;
      });

    const prefixCount = state.prefix.filter(Boolean).length;
    const suffixCount = state.suffix.filter(Boolean).length;

    if (prefixCount + suffixCount === 0) {
      $('rarity').value = 'normal';
    } else if (prefixCount <= 1 && suffixCount <= 1) {
      $('rarity').value = 'magic';
      $('targetRarity').value = 'magic';
    } else {
      $('rarity').value = 'rare';
      $('targetRarity').value = 'rare';
    }

    renderBaseDetails();
    renderCurrentState();
    removeInvalidSelections();
    renderSlots();

    closeSheet('captureSheet');
    switchView('craft');
  }

  function bindEvents() {
    $('newProjectBtn').addEventListener('click', () => switchView('craft'));
    $('quickCraftBtn').addEventListener('click', () => switchView('craft'));
    $('quickCaptureBtn').addEventListener('click', () => {
      resetScanView();
      openSheet('captureSheet');
    });
    $('captureBtn').addEventListener('click', () => {
      resetScanView();
      openSheet('captureSheet');
    });
    $('openProjectsBtn').addEventListener('click', () => switchView('projects'));

    document.querySelectorAll('.navbtn').forEach(button => {
      button.addEventListener('click', () => switchView(button.dataset.view));
    });

    $('category').addEventListener('change', renderClassOptions);
    $('itemClass').addEventListener('change', renderBaseOptions);
    $('ilevel').addEventListener('input', () => {
      removeInvalidSelections();
      renderBaseDetails();
      renderSlots();
    });

    $('rarity').addEventListener('change', renderCurrentState);
    $('targetRarity').addEventListener('change', () => {
      trimForRarity();
      renderSlots();
    });

    $('basePicker').addEventListener('click', openBaseSheet);
    $('baseSearch').addEventListener('input', renderBaseResults);
    $('closeBaseSheetBtn').addEventListener('click', () => closeSheet('baseSheet'));

    $('modSearch').addEventListener('input', renderModResults);
    $('closeModSheetBtn').addEventListener('click', () => closeSheet('modSheet'));

    $('resetCraftBtn').addEventListener('click', resetCraft);
    $('saveProjectBtn').addEventListener('click', saveProject);
    $('savePricesBtn').addEventListener('click', savePrices);

    $('closeCaptureSheetBtn').addEventListener('click', () => closeSheet('captureSheet'));
    $('manualEntryBtn').addEventListener('click', () => {
      closeSheet('captureSheet');
      switchView('craft');
    });

    $('cameraInput').addEventListener('change', event => handleImage(event.target));
    $('galleryInput').addEventListener('change', event => handleImage(event.target));
    $('recognizedClass').addEventListener('change', () =>
      populateRecognizedBases($('recognizedClass').value)
    );
    $('scanAgainBtn').addEventListener('click', resetScanView);
    $('applyScanBtn').addEventListener('click', applyScan);

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      document.querySelectorAll('.sheet.open').forEach(sheet => closeSheet(sheet.id));
    });
  }

  async function init() {
    bindEvents();
    renderCurrentState();
    renderSlots();
    renderPrices();
    updateHomeProject();

    try {
      await loadApplicationData();
      await renderClassOptions();
      populateRecognizedClasses($('itemClass').value);
      renderDatabaseView();
    } catch (error) {
      console.error(error);
      setDataStatus(
        `Datenbank konnte nicht geladen werden: ${error.message}`,
        'warn'
      );

      $('basePicker').disabled = true;
      $('basePickerName').textContent = 'Datenbank nicht verfügbar';
      $('baseDetails').innerHTML = `
        <div class="status warn">
          Prüfe, ob der Ordner generated/app-data auf GitHub vorhanden ist
          und GitHub Pages den neuesten Commit veröffentlicht hat.
        </div>
      `;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
