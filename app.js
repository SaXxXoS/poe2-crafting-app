import { createModifierCatalog } from './src/engine/browser.mjs';
import {
  SINGLE_STEP_ACTIONS,
  canRunSingleStep,
  createSingleStepItem,
  optionalAffixGroupsFile,
  runSingleStep,
  validateItemLevel
} from './src/ui/single-step-controller.mjs';
import { renderSingleStepResult } from './src/ui/single-step-result-renderer.mjs';
import {
  adoptSingleStepResult,
  applySingleStepUndo,
  canUndoSingleStep
} from './src/ui/single-step-undo.mjs';

(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const CURRENT_MAX_ITEM_LEVEL = window.EXILEFORGE_CONFIG.CURRENT_MAX_ITEM_LEVEL;

  const APP_DATA_ROOT = './generated/poe2db/app';
  const PRICE_ITEMS = [
    'Orb of Transmutation',
    'Orb of Augmentation',
    'Regal Orb',
    'Exalted Orb',
    'Divine Orb',
    'Sphäre der Annullierung',
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

  const BASE_NAME_DE = {
    'Guardian Spear': 'Wächterspeer',
    'Spiked Spear': 'Stachelspeer',
    'Stalking Spear': 'Pirschspeer',
    'Akoyan Spear': 'Akoyanischer Speer',
    'Flying Spear': 'Fliegender Speer',
    'Grand Spear': 'Großer Speer',
    'War Spear': 'Kriegsspeer',
    'Jagged Spear': 'Gezackter Speer'
  };

  const IMPLICIT_TEXT_DE = {
    'SpearImplicitDisplaySpearThrow1': 'Kann als Speer geworfen werden',
    'SpearImplicitLocalProjectileSpeed1': 'Erhöhte Projektilgeschwindigkeit',
    'SpearImplicitDeflectDamagePrevented1': 'Zusätzliche Schadensverhinderung durch Ablenken',
    'SpearImplicitFasterBleed1': 'Blutungen verursachen ihren Schaden schneller',
    'SpearImplicitLocalChanceToMaim1': 'Chance, Gegner zu verstümmeln',
    'SpearImplicitWeaponRange1': 'Erhöhte Waffenreichweite'
  };

  const STAT_LABELS_DE = {
    'local_attack_speed_+%': 'Erhöhte Angriffsgeschwindigkeit',
    'local_critical_strike_chance_+%': 'Erhöhte kritische Trefferchance',
    'local_physical_damage_+%': 'Erhöhter physischer Schaden',
    'local_minimum_added_physical_damage': 'Zusätzlicher minimaler physischer Schaden',
    'local_maximum_added_physical_damage': 'Zusätzlicher maximaler physischer Schaden',
    'local_minimum_added_fire_damage': 'Zusätzlicher minimaler Feuerschaden',
    'local_maximum_added_fire_damage': 'Zusätzlicher maximaler Feuerschaden',
    'local_minimum_added_cold_damage': 'Zusätzlicher minimaler Kälteschaden',
    'local_maximum_added_cold_damage': 'Zusätzlicher maximaler Kälteschaden',
    'local_minimum_added_lightning_damage': 'Zusätzlicher minimaler Blitzschaden',
    'local_maximum_added_lightning_damage': 'Zusätzlicher maximaler Blitzschaden',
    'additional_strength': 'Stärke',
    'additional_dexterity': 'Geschick',
    'additional_intelligence': 'Intelligenz',
    'base_maximum_life': 'Maximales Leben',
    'base_maximum_mana': 'Maximales Mana',
    'base_life_regeneration_rate_per_minute': 'Lebensregeneration',
    'base_mana_regeneration_rate_per_minute': 'Manaregeneration',
    'base_fire_damage_resistance_%': 'Feuerwiderstand',
    'base_cold_damage_resistance_%': 'Kältewiderstand',
    'base_lightning_damage_resistance_%': 'Blitzwiderstand',
    'base_chaos_damage_resistance_%': 'Chaoswiderstand',
    'base_item_found_rarity_+%': 'Seltenheit gefundener Gegenstände',
    'base_movement_velocity_+%': 'Bewegungsgeschwindigkeit',
    'base_accuracy_rating': 'Genauigkeit',
    'base_life_gained_on_enemy_death': 'Leben bei Tötung',
    'base_mana_gained_on_enemy_death': 'Mana bei Tötung',
    'local_weapon_range_+': 'Waffenreichweite',
    'local_projectile_speed_+%': 'Projektilgeschwindigkeit',
    'local_chance_to_maim_on_hit_%': 'Chance auf Verstümmeln',
    'bleeding_damage_+%_final': 'Blutungsschaden',
    'attack_damage_+%': 'Angriffsschaden',
    'spell_damage_+%': 'Zauberschaden',
    'cast_speed_+%': 'Zaubergeschwindigkeit',
    'critical_strike_chance_+%': 'Kritische Trefferchance',
    'critical_strike_multiplier_+': 'Multiplikator für kritische Treffer'
  };

  const HIDDEN_STAT_HINTS = [
    'ultimatum',
    'wager',
    'chest_',
    'display_generic',
    'warning_sound',
    'dropped_item_level',
    'additional_unique_items',
    'item_quantity_final_from_mod',
    'item_rarity_final_from_mod',
    '_hash'
  ];

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
      affixGroups: [],
      poolFiles: {},
      loadedPools: new Map(),
      crafting: {}
    },
    singleStep: {
      catalog: null,
      itemState: null,
      result: null,
      undoItemState: null,
      statusMessage: null,
      busy: false
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

  function currentItemLevel() {
    return validateItemLevel($('ilevel').value).value;
  }

  function enforceItemLevelLimit() {
    const input = $('ilevel');
    input.max = String(CURRENT_MAX_ITEM_LEVEL);
  }

  function formatInternalName(value) {
    return String(value || '')
      .replace(/^Metadata\/Modifiers\//, '')
      .replace(/^stat_/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, character => character.toUpperCase())
      .trim();
  }

  function cleanStatId(value) {
    return String(value || '')
      .replace(/^stat_/, '')
      .trim();
  }

  function isHiddenStat(statId) {
    const value = cleanStatId(statId).toLowerCase();
    return HIDDEN_STAT_HINTS.some(hint => value.includes(hint));
  }

  function statLabelDe(statId) {
    const id = cleanStatId(statId);

    if (STAT_LABELS_DE[id]) return STAT_LABELS_DE[id];

    const lower = id.toLowerCase();

    if (lower.includes('fire') && lower.includes('resistance')) return 'Feuerwiderstand';
    if (lower.includes('cold') && lower.includes('resistance')) return 'Kältewiderstand';
    if (lower.includes('lightning') && lower.includes('resistance')) return 'Blitzwiderstand';
    if (lower.includes('chaos') && lower.includes('resistance')) return 'Chaoswiderstand';
    if (lower.includes('attack_speed')) return 'Angriffsgeschwindigkeit';
    if (lower.includes('cast_speed')) return 'Zaubergeschwindigkeit';
    if (lower.includes('critical_strike_chance')) return 'Kritische Trefferchance';
    if (lower.includes('critical_strike_multiplier')) return 'Multiplikator für kritische Treffer';
    if (lower.includes('maximum_life')) return 'Maximales Leben';
    if (lower.includes('maximum_mana')) return 'Maximales Mana';
    if (lower.includes('physical_damage')) return 'Physischer Schaden';
    if (lower.includes('fire_damage')) return 'Feuerschaden';
    if (lower.includes('cold_damage')) return 'Kälteschaden';
    if (lower.includes('lightning_damage')) return 'Blitzschaden';
    if (lower.includes('strength')) return 'Stärke';
    if (lower.includes('dexterity')) return 'Geschick';
    if (lower.includes('intelligence')) return 'Intelligenz';
    if (lower.includes('accuracy')) return 'Genauigkeit';
    if (lower.includes('projectile_speed')) return 'Projektilgeschwindigkeit';
    if (lower.includes('weapon_range')) return 'Waffenreichweite';

    return formatInternalName(id);
  }

  function formatStatValue(stat, label) {
    const min = Number(stat.min ?? 0);
    const max = Number(stat.max ?? min);
    const raw = min === max ? String(min) : `${min}–${max}`;
    const id = cleanStatId(stat.id).toLowerCase();

    const isPercent =
      id.includes('%') ||
      id.includes('_+%') ||
      id.includes('resistance') ||
      id.includes('speed') ||
      id.includes('chance');

    if (isPercent && !label.includes('Multiplikator')) return `${raw} %`;
    return raw;
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
          name: 'Impliziter Modtext nicht verfügbar',
          kind: 'Basis-Implizit'
        };
      }

      if (implicit && typeof implicit === 'object') {
        const id = implicit.id ?? implicit.mod_id ?? implicit.modId ?? `implicit-${index}`;
        return {
          id,
          name: implicit.displayText || 'Impliziter Modtext nicht verfügbar',
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
    const statNames = (mod.stats || [])
      .filter(stat => !isHiddenStat(stat.id))
      .map(stat => statLabelDe(stat.id))
      .filter(Boolean);

    if (statNames.length) return [...new Set(statNames)].join(' + ');

    if (mod.name) return mod.name;
    return formatInternalName(mod.id);
  }

  function modRange(mod) {
    const stats = Array.isArray(mod.stats)
      ? mod.stats.filter(stat => !isHiddenStat(stat.id))
      : [];

    if (!stats.length) return 'Kein darstellbarer Wertebereich';

    return stats.map(stat => {
      const label = statLabelDe(stat.id);
      const value = formatStatValue(stat, label);
      return `${label}: ${value}`;
    }).join(' · ');
  }

  function tierLabel(mod) {
    return mod.requiredLevel > 0
      ? `ab Item-Level ${mod.requiredLevel}`
      : 'ohne Mindeststufe';
  }

  function adaptMod(mod) {
    const displayText = mod.displayText;

    return {
      id: mod.id,
      name: displayText,
      displayText,
      range: '',
      tier: mod.tier
        ? `Tier ${mod.tier} · ab Item-Level ${Number(mod.requiredLevel || 0)}`
        : tierLabel(mod),
      lvl: Number(mod.requiredLevel || 0),
      group: mod.group || mod.id,
      generationType: mod.generationType,
      spawnWeights: mod.spawnWeights || [],
      generationWeights: mod.generationWeights || [],
      visible: Boolean(displayText),
      raw: mod
    };
  }

  function adaptBase(base) {
    const properties = propertyEntries(base.properties);

    return {
      ...base,
      name: base.nameDe || BASE_NAME_DE[base.name] || base.name || base.id,
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
    const mods = (modDocument.mods || []).map(adaptMod).filter(mod => mod.visible);
    const classes = indexDocument.classes || [];
    const affixGroupsFile = optionalAffixGroupsFile(indexDocument);
    const affixGroupDocument = affixGroupsFile
      ? await fetchJson(`${APP_DATA_ROOT}/${affixGroupsFile}`)
      : null;

    state.singleStep.catalog = affixGroupDocument
      ? createModifierCatalog({
          index: indexDocument,
          bases: baseDocument,
          mods: modDocument,
          affixGroups: affixGroupDocument
        })
      : null;

    state.data.bases = bases;
    state.data.basesById = new Map(bases.map(base => [base.id, base]));
    state.data.mods = mods;
    state.data.modsById = new Map(mods.map(mod => [mod.id, mod]));
    state.data.affixGroups = affixGroupDocument?.groups || [];
    state.data.classes = classes;
    state.data.classById = new Map(classes.map(itemClass => [itemClass.id, itemClass]));
    state.data.poolFiles = indexDocument.poolFiles || {};

    const craftingEntries = Object.entries(indexDocument.craftingFiles || {});
    const craftingDocuments = await Promise.all(
      craftingEntries.map(([, relativeFile]) => fetchJson(`${APP_DATA_ROOT}/${relativeFile}`))
    );
    state.data.crafting = Object.fromEntries(
      craftingEntries.map(([key], index) => [key, craftingDocuments[index]])
    );

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
      `${counts.poolFiles ?? Object.keys(state.data.poolFiles).length} Pool-Dateien · ` +
      `${counts.craftingFiles ?? craftingEntries.length} Crafting-Datensätze`,
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
            ${CLASS_LABELS_DE[base.itemClass] || base.itemClassName || base.itemClass} · Item-Level ${currentItemLevel() ?? '–'}
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

  function actionLabel(actionId) {
    return SINGLE_STEP_ACTIONS.find(action => action.id === actionId)?.label || actionId;
  }

  function resetSingleStep() {
    state.singleStep.result = null;
    state.singleStep.undoItemState = null;
    state.singleStep.statusMessage = null;
    const base = currentBase();
    const itemLevelValidation = validateItemLevel($('ilevel').value);
    try {
      state.singleStep.itemState = base && itemLevelValidation.valid
        ? createSingleStepItem({
            baseTypeId: base.id,
            itemClassId: base.itemClass,
            itemLevel: itemLevelValidation.value,
            rarity: $('rarity').value
          })
        : null;
    } catch (error) {
      state.singleStep.itemState = null;
      state.singleStep.result = { status: 'error', message: 'Der Ausgangszustand des Gegenstands ist ungültig.' };
    }
    renderSingleStep();
  }

  function modifierDisplay(modifierId) {
    const mod = state.data.modsById.get(modifierId);
    return mod?.displayText || mod?.name || 'Modifiertext nicht verfügbar';
  }

  function renderSingleStep() {
    const itemLevelValidation = validateItemLevel($('ilevel').value);
    const readiness = canRunSingleStep({
      itemState: state.singleStep.itemState,
      catalog: state.singleStep.catalog,
      actionId: $('singleStepAction')?.value,
      busy: state.singleStep.busy,
      itemLevelValidation
    });
    $('singleStepRunBtn').disabled = !readiness.enabled;
    $('singleStepUndoBtn').disabled = !canUndoSingleStep({
      undoItemState: state.singleStep.undoItemState,
      busy: state.singleStep.busy
    });
    const statusMessage = state.singleStep.statusMessage || readiness.reason;
    $('singleStepReadiness').className = `status${state.singleStep.statusMessage || readiness.enabled ? ' success' : ' warn'}`;
    $('singleStepReadiness').textContent = statusMessage;
    renderSingleStepResult({
      document,
      container: $('singleStepResult'),
      result: state.singleStep.result,
      currentItemState: state.singleStep.itemState,
      actionLabel: actionLabel($('singleStepAction').value),
      modifierDisplay
    });
  }

  function nextUiSeed() {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0];
  }

  function executeSingleStep() {
    const itemLevelValidation = validateItemLevel($('ilevel').value);
    const readiness = canRunSingleStep({
      itemState: state.singleStep.itemState,
      catalog: state.singleStep.catalog,
      actionId: $('singleStepAction').value,
      busy: state.singleStep.busy,
      itemLevelValidation
    });
    if (!readiness.enabled) return;
    state.singleStep.undoItemState = null;
    state.singleStep.statusMessage = null;
    state.singleStep.busy = true;
    renderSingleStep();
    try {
      const result = runSingleStep({
        itemState: state.singleStep.itemState,
        catalog: state.singleStep.catalog,
        actionId: $('singleStepAction').value,
        seed: nextUiSeed(),
        itemLevelValidation
      });
      const transition = adoptSingleStepResult({ currentItemState: state.singleStep.itemState, result });
      state.singleStep.result = transition.result;
      state.singleStep.undoItemState = transition.undoItemState;
      state.singleStep.itemState = transition.itemState;
      if (result.status === 'error') console.error('Single-step crafting failed', result);
    } catch (error) {
      console.error('Single-step crafting failed', error);
      state.singleStep.undoItemState = null;
      state.singleStep.result = { status: 'error', message: 'Ein technischer Fehler ist aufgetreten. Der Gegenstand wurde nicht verändert.', itemState: state.singleStep.itemState };
    } finally {
      state.singleStep.busy = false;
      renderSingleStep();
    }
  }

  function undoSingleStep() {
    if (!canUndoSingleStep({ undoItemState: state.singleStep.undoItemState, busy: state.singleStep.busy })) return;
    const transition = applySingleStepUndo({
      currentItemState: state.singleStep.itemState,
      undoItemState: state.singleStep.undoItemState
    });
    state.singleStep.itemState = transition.itemState;
    state.singleStep.undoItemState = transition.undoItemState;
    state.singleStep.result = transition.result;
    state.singleStep.statusMessage = 'Letzter Crafting-Schritt wurde rückgängig gemacht.';
    renderSingleStep();
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
    const itemLevel = currentItemLevel();

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

        card.appendChild(selectButton);
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
      row.dataset.baseId = base.id;

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
        resetSingleStep();
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
    const itemLevel = currentItemLevel();
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
        if (!mod || !mod.visible) return null;

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

  function orderedWeight(rules, baseTags) {
    if (!Array.isArray(rules) || rules.length === 0) return 1;
    const tags = new Set(baseTags || []);
    const match = rules.find(rule => tags.has(rule.tag));
    return Number(match?.weight ?? 0);
  }

  function specialTierAllowed(tier, base) {
    if (!(tier.specialClasses || []).includes(base.itemClass)) return false;
    if ((tier.requiredBaseNamesEn || []).length &&
        !(tier.requiredBaseNamesEn || []).includes(base.nameEn)) return false;
    return orderedWeight(tier.spawnWeights, base.tags) > 0 &&
      orderedWeight(tier.generationWeights, base.tags) > 0;
  }

  function selectableModFromTier(group, tier, spawnWeight) {
    const regular = state.data.modsById.get(tier.modId);
    if (regular) {
      return {
        ...regular,
        group: group.familyId,
        lvl: Number(tier.requiredLevel || 0),
        tier: tier.displayTier ? `Tier ${tier.displayTier} · ab Item-Level ${tier.requiredLevel}` : `ab Item-Level ${tier.requiredLevel}`,
        spawnWeight
      };
    }
    return {
      id: tier.modId,
      name: tier.displayText,
      displayText: tier.displayText,
      range: tier.valueSummary || '',
      tier: tier.displayTier ? `Tier ${tier.displayTier} · ab Item-Level ${tier.requiredLevel}` : `ab Item-Level ${tier.requiredLevel}`,
      lvl: Number(tier.requiredLevel || 0),
      group: group.familyId,
      generationType: group.generationType,
      spawnWeight,
      visible: Boolean(tier.displayText),
      raw: tier
    };
  }

  async function availableModGroups() {
    const base = currentBase();
    if (!base) return [];
    const pool = await poolForCurrentBase();
    const rows = state.activeType === 'prefix' ? pool.p || [] : pool.s || [];
    const poolById = new Map(rows.map(([id, level, weight], order) =>
      [id, { level: Number(level || 0), weight: Number(weight || 0), order }]
    ));
    const itemLevel = currentItemLevel();
    const query = normalizeText($('modSearch').value);
    const current = state[state.activeType][state.activeIndex];
    const usedGroups = new Set(
      [...state.prefix, ...state.suffix]
        .filter(Boolean)
        .filter(mod => mod !== current)
        .map(mod => mod.group)
    );

    return state.data.affixGroups
      .filter(group => group.generationType === state.activeType && !usedGroups.has(group.familyId))
      .map(group => {
        const groupMatches = normalizeText(group.displayName).includes(query);
        const tiers = group.tiers.map(tier => {
          const poolRow = poolById.get(tier.modId);
          const regularAllowed = Boolean(poolRow && poolRow.weight > 0);
          const specialAllowed = specialTierAllowed(tier, base);
          if (!regularAllowed && !specialAllowed) return null;
          const requiredLevel = Number(poolRow?.level ?? tier.requiredLevel ?? 0);
          if (requiredLevel > itemLevel) return null;
          const tierMatches = normalizeText(`${tier.displayText} ${tier.valueSummary} ${tier.tier}`).includes(query);
          if (query && !groupMatches && !tierMatches) return null;
          const sources = [];
          if (regularAllowed) sources.push({ type: 'Normal', sourceId: tier.sourceKey });
          for (const source of tier.craftingSources || []) {
            if (specialAllowed || regularAllowed) sources.push(source);
          }
          return {
            ...tier,
            displayTier: tier.displayTiers?.[base.itemClass] ?? null,
            requiredLevel,
            spawnWeight: poolRow?.weight ?? orderedWeight(tier.spawnWeights, base.tags),
            sources,
            order: poolRow?.order ?? Number.MAX_SAFE_INTEGER,
            selection: selectableModFromTier(group, { ...tier, requiredLevel }, poolRow?.weight ?? 1)
          };
        }).filter(Boolean);
        if (!tiers.length) return null;
        tiers.sort((a, b) => Number(a.displayTier ?? 999) - Number(b.displayTier ?? 999) || b.requiredLevel - a.requiredLevel || a.sourceKey.localeCompare(b.sourceKey));
        return {
          ...group,
          tiers,
          autoExpand: Boolean(query),
          order: Math.min(...tiers.map(tier => tier.order))
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.order - b.order || a.displayName.localeCompare(b.displayName, 'de'));
  }

  async function renderModResults() {
    const type = state.activeType;
    const index = state.activeIndex;
    const selected = state[type][index];
    const list = await availableModGroups();

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

    list.forEach(group => {
      const wrapper = document.createElement('section');
      wrapper.className = 'affix-family';
      wrapper.dataset.familyId = group.familyId;
      const toggle = document.createElement('button');
      toggle.className = 'affix-family-toggle';
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', String(group.autoExpand));
      toggle.innerHTML = `<span class="affix-family-arrow">▸</span><b class="affix-family-name"></b><small>${group.tiers.length}</small>`;
      toggle.querySelector('.affix-family-name').textContent = group.displayName;
      const tierList = document.createElement('div');
      tierList.className = 'affix-tier-list';
      tierList.hidden = !group.autoExpand;

      for (const tier of group.tiers) {
        const tierRow = document.createElement('div');
        tierRow.className = 'affix-tier-row';
        tierRow.dataset.modId = tier.modId;
        tierRow.dataset.sourceKey = tier.sourceKey;
        tierRow.dataset.displayText = tier.displayText;
        tierRow.dataset.normal = String(tier.sources.some(source => source.type === 'Normal'));
        tierRow.dataset.requiredLevel = String(tier.requiredLevel);
        const badges = tier.sources.map(source => `<span class="source-badge source-${normalizeText(source.type)}">${source.type}</span>`).join('');
        tierRow.innerHTML = `
          <div class="affix-tier-main">
            <b>${tier.displayTier ? `T${tier.displayTier}` : 'Spezial'}</b>
            <span>${tier.valueSummary || tier.displayText}</span>
            <small>ilvl ${tier.requiredLevel}</small>
          </div>
          <div class="affix-tier-actions"><div class="affix-tier-badges">${badges}</div><button class="add" type="button">Wählen</button></div>`;
        tierRow.querySelector('button').addEventListener('click', () => {
          state[type][index] = tier.selection;
          renderSlots();
          closeSheet('modSheet');
        });
        tierList.appendChild(tierRow);
      }
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(expanded));
        tierList.hidden = !expanded;
      });
      wrapper.append(toggle, tierList);
      $('modResults').appendChild(wrapper);
    });
  }

  function resetCraft() {
    state.prefix = [null, null, null];
    state.suffix = [null, null, null];
    renderSlots();
    resetSingleStep();
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
    resetSingleStep();
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
      if (match) return Math.min(CURRENT_MAX_ITEM_LEVEL, Math.max(1, Number(match[1])));
    }

    return currentItemLevel();
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
    resetSingleStep();

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

    $('category').addEventListener('change', async () => { await renderClassOptions(); resetSingleStep(); });
    $('itemClass').addEventListener('change', async () => { await renderBaseOptions(); resetSingleStep(); });
    $('ilevel').addEventListener('input', () => {
      enforceItemLevelLimit();
      removeInvalidSelections();
      renderBaseDetails();
      renderSlots();
      resetSingleStep();
      if ($('modSheet').classList.contains('open')) renderModResults();
    });

    $('rarity').addEventListener('change', () => { renderCurrentState(); resetSingleStep(); });
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
    $('singleStepAction').addEventListener('change', renderSingleStep);
    $('singleStepRunBtn').addEventListener('click', executeSingleStep);
    $('singleStepUndoBtn').addEventListener('click', undoSingleStep);
    $('singleStepResetBtn').addEventListener('click', resetSingleStep);
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
    enforceItemLevelLimit();
    bindEvents();
    renderCurrentState();
    $('singleStepAction').innerHTML = SINGLE_STEP_ACTIONS
      .map(action => `<option value="${action.id}">${action.label}</option>`)
      .join('');
    renderSingleStep();
    renderSlots();
    renderPrices();
    updateHomeProject();

    try {
      await loadApplicationData();
      await renderClassOptions();
      resetSingleStep();
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
          Prüfe, ob der Ordner generated/poe2db/app auf GitHub vorhanden ist
          und GitHub Pages den neuesten Commit veröffentlicht hat.
        </div>
      `;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
