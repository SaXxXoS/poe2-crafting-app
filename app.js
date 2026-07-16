(() => {
  'use strict';

  const DATA = window.EXILEFORGE_DATA;
  const $ = id => document.getElementById(id);

  const state = {
    prefix:[null,null,null],
    suffix:[null,null,null],
    activeType:null,
    activeIndex:null
  };

  function switchView(id){
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    $(id).classList.add('active');

    document.querySelectorAll('.navbtn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === id);
    });

    window.scrollTo({top:0,behavior:'auto'});
    if(id === 'projects') renderProjects();
  }

  function openSheet(id){
    $(id).classList.add('open');
    $(id).setAttribute('aria-hidden','false');
    document.body.classList.add('modal-open');
  }

  function closeSheet(id){
    $(id).classList.remove('open');
    $(id).setAttribute('aria-hidden','true');

    if(!document.querySelector('.sheet.open')){
      document.body.classList.remove('modal-open');
    }
  }

  function renderClassOptions(){
    const classes = DATA.classOptions[$('category').value] || [];
    $('itemClass').innerHTML = classes.map(c => `<option value="${c}">${c}</option>`).join('');
    renderBaseOptions();
  }

  function currentBase(){
    const cls = $('itemClass').value;
    const list = DATA.baseItems[cls] || [];
    const selectedId = $('basePicker').dataset.baseId;
    return list.find(base => base.id === selectedId) || list[0] || null;
  }

  function renderBaseOptions(){
    const cls = $('itemClass').value;
    const list = DATA.baseItems[cls] || [];

    if(list.length){
      $('basePicker').disabled = false;
      $('basePicker').classList.remove('disabled');

      if(!list.some(base => base.id === $('basePicker').dataset.baseId)){
        $('basePicker').dataset.baseId = list[0].id;
      }

      $('basePickerName').textContent = currentBase().name;
    } else {
      $('basePicker').disabled = true;
      $('basePicker').classList.add('disabled');
      $('basePicker').dataset.baseId = '';
      $('basePickerName').textContent = `${cls}: Datenimport ausstehend`;
    }

    renderBaseDetails();
    removeInvalidSelections();
    renderSlots();
  }

  function renderBaseDetails(){
    const base = currentBase();

    if(!base){
      $('baseDetails').innerHTML = '<div class="status warn">Für diese Klasse ist der vollständige Basisimport noch nicht angeschlossen.</div>';
      return;
    }

    const implicits = base.implicits.map(implicit => `
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
          <div style="color:var(--muted);font-size:11px;margin-top:4px">Basisdaten · Item-Level ${Number($('ilevel').value) || 1}</div>
        </div>
        <span class="verified">Basis</span>
      </div>

      <div class="base-grid">
        <div class="base-stat"><small>Physischer Schaden</small><b>${base.physical}</b></div>
        <div class="base-stat"><small>Angriffe pro Sekunde</small><b>${base.aps}</b></div>
        <div class="base-stat"><small>Kritische Chance</small><b>${base.crit}</b></div>
        <div class="base-stat"><small>Anforderungen</small><b>Stufe ${base.requiredLevel}<br>${base.requirements}</b></div>
      </div>

      <div class="implicit-block">
        <div class="implicit-label">Eigenschaften der Basis</div>
        ${implicits || '<div class="status">Keine sichtbaren Basis-Implizits.</div>'}
      </div>
    `;
  }

  function renderCurrentState(){
    const rarity = $('rarity').value;

    if(rarity === 'normal'){
      $('currentState').innerHTML = '<strong>Aktueller Gegenstand:</strong> Normale Basis · 0 Präfixe · 0 Suffixe.<br><span style="color:var(--gold2)">Darunter wählst du trotzdem die Ziel-Affixe aus.</span>';
    } else if(rarity === 'magic'){
      $('currentState').innerHTML = '<strong>Aktueller Gegenstand:</strong> Magisch · höchstens 1 Präfix und 1 Suffix vorhanden.';
    } else {
      $('currentState').innerHTML = '<strong>Aktueller Gegenstand:</strong> Selten · vorhandene Affixe werden später als Ist-Zustand erfasst.';
    }
  }

  function slotLimit(){
    return $('targetRarity').value === 'magic' ? 1 : 3;
  }

  function trimForRarity(){
    const max = slotLimit();

    ['prefix','suffix'].forEach(type => {
      for(let i = max; i < 3; i++){
        state[type][i] = null;
      }
    });
  }

  function removeInvalidSelections(){
    const ilvl = Number($('ilevel').value) || 1;

    ['prefix','suffix'].forEach(type => {
      state[type] = state[type].map(mod => mod && mod.lvl <= ilvl ? mod : null);
    });
  }

  function renderSlots(){
    ['prefix','suffix'].forEach(type => {
      const host = $(type + 'Slots');
      const max = slotLimit();
      host.innerHTML = '';

      for(let index = 0; index < 3; index++){
        const mod = state[type][index];

        if(index >= max){
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

        if(!mod){
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
          button.addEventListener('click', () => openModSheet(type,index));
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
        selectButton.addEventListener('click', () => openModSheet(type,index));

        const range = document.createElement('div');
        range.className = 'affix-range';
        range.innerHTML = `<span>Möglicher Roll</span><strong>${mod.range}</strong>`;

        card.appendChild(selectButton);
        card.appendChild(range);
        host.appendChild(card);
      }

      $(type + 'Count').textContent = `${state[type].filter(Boolean).length} / ${max}`;
    });
  }

  function openBaseSheet(){
    if($('basePicker').disabled) return;

    $('baseSheetHeading').textContent = `${$('itemClass').value}: Basis auswählen`;
    $('baseSearch').value = '';
    renderBaseResults();
    openSheet('baseSheet');
  }

  function renderBaseResults(){
    const cls = $('itemClass').value;
    const query = $('baseSearch').value.trim().toLowerCase();
    const list = (DATA.baseItems[cls] || []).filter(base => base.name.toLowerCase().includes(query));

    $('baseResults').innerHTML = '';

    if(!list.length){
      $('baseResults').innerHTML = '<div class="empty">Keine passende Basis gefunden.</div>';
      return;
    }

    list.forEach(base => {
      const row = document.createElement('div');
      row.className = 'result';

      const implicitText = base.implicits
        .filter(i => i.kind !== 'Gewährte Fertigkeit')
        .map(i => i.name)
        .join(' · ') || 'Keine zusätzliche sichtbare Basis-Eigenschaft';

      row.innerHTML = `
        <div>
          <b>${base.name}</b>
          <small>Stufe ${base.requiredLevel} · ${base.physical} · ${base.aps} APS<br>${implicitText}</small>
        </div>
        <button class="add" type="button">Wählen</button>
      `;

      row.querySelector('button').addEventListener('click', () => {
        $('basePicker').dataset.baseId = base.id;
        $('basePickerName').textContent = base.name;
        renderBaseDetails();
        closeSheet('baseSheet');
      });

      $('baseResults').appendChild(row);
    });
  }

  function openModSheet(type,index){
    state.activeType = type;
    state.activeIndex = index;

    $('modSheetHeading').textContent = `${type === 'prefix' ? 'Präfix' : 'Suffix'} ${index + 1} auswählen`;
    $('modSearch').value = '';
    renderModResults();
    openSheet('modSheet');
  }

  function availableMods(){
    const cls = $('itemClass').value;
    const type = state.activeType;
    const ilvl = Number($('ilevel').value) || 1;
    const query = $('modSearch').value.trim().toLowerCase();

    const current = state[type][state.activeIndex];
    const usedGroups = new Set(
      [...state.prefix,...state.suffix]
        .filter(Boolean)
        .filter(mod => mod !== current)
        .map(mod => mod.group)
    );

    return ((DATA.mods[cls] || {})[type] || []).filter(mod => {
      const haystack = `${mod.name} ${mod.tier} ${mod.range}`.toLowerCase();

      return mod.lvl <= ilvl &&
        !usedGroups.has(mod.group) &&
        (!query || haystack.includes(query));
    });
  }

  function renderModResults(){
    const type = state.activeType;
    const index = state.activeIndex;
    const selected = state[type][index];
    const list = availableMods();

    $('modResults').innerHTML = '';

    if(selected){
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

    if(!list.length){
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Keine passenden Mods gefunden.';
      $('modResults').appendChild(empty);
      return;
    }

    list.forEach(mod => {
      const row = document.createElement('div');
      row.className = 'result';
      row.innerHTML = `
        <div>
          <b>${mod.name}</b>
          <small>${mod.tier} · Mindest-Item-Level ${mod.lvl} · ${mod.range}</small>
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

  function resetCraft(){
    state.prefix = [null,null,null];
    state.suffix = [null,null,null];
    renderSlots();
  }

  function saveProject(){
    const base = currentBase();

    const project = {
      itemClass:$('itemClass').value,
      baseId:base?.id || '',
      baseName:base?.name || '',
      ilevel:$('ilevel').value,
      rarity:$('rarity').value,
      targetRarity:$('targetRarity').value,
      budget:$('budget').value,
      strategy:$('strategy').value,
      prefix:state.prefix,
      suffix:state.suffix
    };

    localStorage.setItem('exileforge_project', JSON.stringify(project));
    updateHomeProject();
    alert('Crafting-Ziel wurde gespeichert.');
  }

  function updateHomeProject(){
    const project = JSON.parse(localStorage.getItem('exileforge_project') || 'null');

    $('homeProject').textContent = project
      ? `${project.baseName} · Item-Level ${project.ilevel}`
      : 'Noch kein Ziel gespeichert';

    $('homeProjectMeta').textContent = project
      ? `${project.itemClass} · ${project.strategy} · Budget ${project.budget} Divine`
      : 'Erstelle zuerst ein Crafting-Projekt.';
  }

  function renderProjects(){
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

    const editButton = $('editProjectBtn');
    if(editButton){
      editButton.addEventListener('click', loadProject);
    }
  }

  function loadProject(){
    const project = JSON.parse(localStorage.getItem('exileforge_project') || 'null');
    if(!project) return;

    $('itemClass').value = project.itemClass;
    renderBaseOptions();

    $('basePicker').dataset.baseId = project.baseId;
    $('basePickerName').textContent = project.baseName;
    $('ilevel').value = project.ilevel;
    $('rarity').value = project.rarity;
    $('targetRarity').value = project.targetRarity;
    $('budget').value = project.budget;
    $('strategy').value = project.strategy;

    state.prefix = project.prefix || [null,null,null];
    state.suffix = project.suffix || [null,null,null];

    renderBaseDetails();
    renderCurrentState();
    renderSlots();
    switchView('craft');
  }

  function renderPrices(){
    const stored = JSON.parse(localStorage.getItem('exileforge_prices') || '{}');

    $('priceList').innerHTML = DATA.priceItems.map((name,index) => `
      <div class="price-row">
        <div>
          <strong>${name}</strong>
          <div style="color:var(--muted);font-size:11px">Wert in Exalted</div>
        </div>
        <input id="price${index}" type="number" step="0.01" value="${stored[name] ?? ''}" placeholder="–">
      </div>
    `).join('');
  }

  function savePrices(){
    const values = {};

    DATA.priceItems.forEach((name,index) => {
      const value = $('price' + index).value;
      if(value !== '') values[name] = Number(value);
    });

    localStorage.setItem('exileforge_prices', JSON.stringify(values));
    alert('Preise wurden lokal gespeichert.');
  }

  function handleImage(input){
    const file = input.files?.[0];
    $('imageStatus').textContent = file
      ? `Bild ausgewählt: ${file.name}. Automatische Erkennung folgt später.`
      : 'Noch kein Bild ausgewählt.';
  }

  function bindEvents(){
    $('newProjectBtn').addEventListener('click', () => switchView('craft'));
    $('quickCraftBtn').addEventListener('click', () => switchView('craft'));
    $('quickCaptureBtn').addEventListener('click', () => openSheet('captureSheet'));
    $('captureBtn').addEventListener('click', () => openSheet('captureSheet'));
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

    document.addEventListener('keydown', event => {
      if(event.key !== 'Escape') return;
      document.querySelectorAll('.sheet.open').forEach(sheet => closeSheet(sheet.id));
    });
  }

  function init(){
    bindEvents();
    renderClassOptions();
    renderCurrentState();
    renderSlots();
    renderPrices();
    updateHomeProject();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
