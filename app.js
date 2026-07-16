(() => {
  'use strict';

  const DATA = window.EXILEFORGE_DATA;
  const $ = id => document.getElementById(id);

  const state = {
    prefix:[null,null,null],
    suffix:[null,null,null],
    activeType:null,
    activeIndex:null,
    scan:{file:null,objectUrl:null,rawText:'',recognizedMods:[],selectedModIds:new Set()}
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
    if(file) startImageScan(file);
  }

  function normalizeText(value){return String(value||'').toLocaleLowerCase('de-DE').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9äöüß+%–-]+/g,' ').replace(/\s+/g,' ').trim();}
  function resetScanView(){if(state.scan.objectUrl)URL.revokeObjectURL(state.scan.objectUrl);state.scan={file:null,objectUrl:null,rawText:'',recognizedMods:[],selectedModIds:new Set()};$('scanPanel').hidden=true;$('scanResult').hidden=true;$('captureChoices').hidden=false;$('ocrProgressBar').style.width='0%';$('ocrRawText').textContent='';$('recognizedMods').innerHTML='';populateRecognizedClasses($('itemClass').value||'Speer');populateRecognizedBases($('itemClass').value||'Speer');$('cameraInput').value='';$('galleryInput').value='';}
  function populateRecognizedClasses(selectedClass=''){const classes=Object.values(DATA.classOptions).flat();$('recognizedClass').innerHTML=classes.map(itemClass=>`<option value="${itemClass}">${itemClass}</option>`).join('');if(selectedClass&&classes.includes(selectedClass))$('recognizedClass').value=selectedClass;}
  function detectItemClass(rawText){const normalized=normalizeText(rawText),aliases=DATA.recognition?.classAliases||{};const scored=Object.entries(aliases).map(([itemClass,classAliases])=>{let score=0;for(const alias of classAliases){const needle=normalizeText(alias);if(needle&&normalized.includes(needle))score+=needle.length+10;}for(const base of (DATA.baseItems[itemClass]||[])){const baseName=normalizeText(base.name);if(baseName&&normalized.includes(baseName))score+=baseName.length+50;}return{itemClass,score};}).sort((a,b)=>b.score-a.score);return scored[0]?.score>0?scored[0].itemClass:null;}
  function populateRecognizedBases(itemClass,selectedId=''){const bases=DATA.baseItems[itemClass]||[];$('recognizedBase').innerHTML=bases.length?bases.map(base=>`<option value="${base.id}">${base.name}</option>`).join(''):'<option value="">Keine Basisdaten importiert</option>';if(selectedId&&bases.some(base=>base.id===selectedId))$('recognizedBase').value=selectedId;}
  function findRecognizedBase(rawText,itemClass){const normalized=normalizeText(rawText);return (DATA.baseItems[itemClass]||[]).slice().sort((a,b)=>b.name.length-a.name.length).find(base=>normalized.includes(normalizeText(base.name)))||null;}
  function findRecognizedItemLevel(rawText){for(const pattern of [/gegenstandsstufe\s*[:\-]?\s*(\d{1,3})/i,/item\s*level\s*[:\-]?\s*(\d{1,3})/i,/\bilvl\s*[:\-]?\s*(\d{1,3})/i]){const match=rawText.match(pattern);if(match)return Math.min(100,Math.max(1,Number(match[1])));}return Number($('ilevel').value)||1;}
  function tokenise(value){
    return normalizeText(value)
      .split(' ')
      .filter(token => token.length >= 3 && !/^\d+$/.test(token));
  }

  function similarityScore(source,target){
    const sourceTokens = new Set(tokenise(source));
    const targetTokens = new Set(tokenise(target));

    if(!sourceTokens.size || !targetTokens.size) return 0;

    let matches = 0;
    targetTokens.forEach(token => {
      if(sourceTokens.has(token)) matches += 1;
      else {
        const fuzzy = [...sourceTokens].some(sourceToken =>
          sourceToken.startsWith(token.slice(0,Math.max(4,token.length - 2))) ||
          token.startsWith(sourceToken.slice(0,Math.max(4,sourceToken.length - 2)))
        );
        if(fuzzy) matches += 0.65;
      }
    });

    return matches / targetTokens.size;
  }

  function modAliases(mod){
    const aliases = [mod.name];

    const groupAliases = {
      phys_percent:['erhöhter physischer schaden','erhohter physischer schaden'],
      flat_phys:['fügt physischen schaden hinzu','fugt physischen schaden hinzu'],
      phys_hybrid:['physischer schaden und genauigkeit'],
      flat_cold:['fügt kälteschaden hinzu','fugt kalteschaden hinzu'],
      flat_lightning:['fügt blitzschaden hinzu','fugt blitzschaden hinzu'],
      attack_speed:['erhöhte angriffsgeschwindigkeit','erhohte angriffsgeschwindigkeit'],
      crit_chance:['erhöhte kritische trefferchance','erhohte kritische trefferchance'],
      stun_buildup:['erhöhter betäubungsaufbau','erhohter betaubungsaufbau'],
      projectile_skills:['projektilfertigkeiten','stufen aller projektilfertigkeiten'],
      melee_skills:['nahkampffertigkeiten','stufen aller nahkampffertigkeiten']
    };

    return aliases.concat(groupAliases[mod.group] || []);
  }

  function findRecognizedMods(rawText,itemClass){
    const lines = String(rawText || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length >= 4);

    const mods = DATA.mods[itemClass] || {prefix:[],suffix:[]};
    const found = [];

    ['prefix','suffix'].forEach(type => {
      (mods[type] || []).forEach(mod => {
        let bestScore = 0;
        let bestLine = '';

        for(const line of lines){
          for(const alias of modAliases(mod)){
            const normalizedLine = normalizeText(line);
            const normalizedAlias = normalizeText(alias);

            let score = 0;

            if(normalizedLine.includes(normalizedAlias) || normalizedAlias.includes(normalizedLine)){
              score = 1;
            } else {
              score = similarityScore(line,alias);
            }

            if(score > bestScore){
              bestScore = score;
              bestLine = line;
            }
          }
        }

        if(bestScore >= 0.56){
          const existing = found.find(item => item.mod.group === mod.group);

          if(!existing || bestScore > existing.confidence){
            if(existing){
              const index = found.indexOf(existing);
              found.splice(index,1);
            }

            found.push({
              type,
              mod,
              confidence:bestScore,
              sourceLine:bestLine
            });
          }
        }
      });
    });

    return found
      .sort((a,b) => b.confidence - a.confidence)
      .slice(0,6);
  }

  function renderRecognizedMods(){
    const host = $('recognizedMods');
    host.innerHTML = '';

    if(!state.scan.recognizedMods.length){
      host.innerHTML = `
        <div class="status warn">
          Keine Affixe sicher erkannt. Das kann an Bildqualität oder fehlenden Daten liegen.
          Du kannst Basis und Item-Level trotzdem übernehmen und die Affixe danach manuell wählen.
        </div>
      `;
      return;
    }

    state.scan.selectedModIds = new Set(
      state.scan.recognizedMods
        .filter(item => item.confidence >= 0.64)
        .map(item => item.mod.id)
    );

    state.scan.recognizedMods.forEach(item => {
      const {type,mod,confidence,sourceLine} = item;
      const checked = state.scan.selectedModIds.has(mod.id);

      const row = document.createElement('label');
      row.className = 'recognized-mod';
      row.innerHTML = `
        <input type="checkbox" data-mod-id="${mod.id}" ${checked ? 'checked' : ''}>
        <span>
          <b>${mod.name}</b>
          <small>
            ${type === 'prefix' ? 'Präfix' : 'Suffix'} · ${mod.tier} · möglicher Roll ${mod.range}<br>
            <span class="confidence">Erkennung ${Math.round(confidence * 100)} %</span>
            ${sourceLine ? ` · OCR-Zeile: ${sourceLine}` : ''}
          </small>
        </span>
      `;

      row.querySelector('input').addEventListener('change', event => {
        if(event.target.checked) state.scan.selectedModIds.add(mod.id);
        else state.scan.selectedModIds.delete(mod.id);
      });

      host.appendChild(row);
    });
  }

  function loadImageElement(file){
    return new Promise((resolve,reject) => {
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

  async function prepareImageForOcr(file){
    const image = await loadImageElement(file);
    const maxWidth = 1800;
    const scale = Math.min(1,maxWidth / image.naturalWidth);
    const width = Math.max(1,Math.round(image.naturalWidth * scale));
    const height = Math.max(1,Math.round(image.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d',{willReadFrequently:true});
    context.drawImage(image,0,0,width,height);

    const imageData = context.getImageData(0,0,width,height);
    const pixels = imageData.data;

    for(let index = 0; index < pixels.length; index += 4){
      const luminance =
        (pixels[index] * 0.299) +
        (pixels[index + 1] * 0.587) +
        (pixels[index + 2] * 0.114);

      const boosted = luminance > 150 ? 255 : luminance < 70 ? 0 : Math.min(255,luminance * 1.35);

      pixels[index] = boosted;
      pixels[index + 1] = boosted;
      pixels[index + 2] = boosted;
    }

    context.putImageData(imageData,0,0);

    return new Promise((resolve,reject) => {
      canvas.toBlob(blob => {
        if(blob) resolve(blob);
        else reject(new Error('Bild konnte nicht für OCR vorbereitet werden.'));
      },'image/png',0.95);
    });
  }

  async function runOcr(imageSource,language){
    return Tesseract.recognize(imageSource,language,{
      logger(message){
        if(message.status === 'recognizing text'){
          const percent = Math.round((message.progress || 0) * 100);
          $('ocrProgressBar').style.width = `${percent}%`;
          $('imageStatus').textContent = `Text wird erkannt … ${percent} %`;
        } else if(message.status){
          $('imageStatus').textContent = `OCR: ${message.status}`;
        }
      }
    });
  }

  async function startImageScan(file){
    if(!file) return;

    if(!window.Tesseract){
      $('captureChoices').hidden = true;
      $('scanPanel').hidden = false;
      $('imageStatus').className = 'status warn';
      $('imageStatus').textContent = 'OCR-Bibliothek konnte nicht geladen werden. Prüfe die Internetverbindung und lade die Seite neu.';
      return;
    }

    if(state.scan.objectUrl) URL.revokeObjectURL(state.scan.objectUrl);

    state.scan.file = file;
    state.scan.objectUrl = URL.createObjectURL(file);
    $('imagePreview').src = state.scan.objectUrl;
    $('captureChoices').hidden = true;
    $('scanPanel').hidden = false;
    $('scanResult').hidden = true;
    $('ocrProgressBar').style.width = '2%';
    $('imageStatus').className = 'status';
    $('imageStatus').textContent = 'Bild wird für die Texterkennung vorbereitet …';

    try{
      let preparedImage;

      try{
        preparedImage = await prepareImageForOcr(file);
      } catch(imageError){
        console.warn('Image preprocessing failed, using original file',imageError);
        preparedImage = file;
      }

      let result;

      try{
        result = await runOcr(preparedImage,'deu+eng');
      } catch(primaryError){
        console.warn('German OCR failed, retrying English',primaryError);
        $('imageStatus').textContent = 'Deutsche OCR fehlgeschlagen. Zweiter Versuch …';
        result = await runOcr(preparedImage,'eng');
      }

      const rawText = result?.data?.text || '';
      state.scan.rawText = rawText;

      const detectedClass = detectItemClass(rawText) || $('itemClass').value || 'Speer';
      const recognizedBase = findRecognizedBase(rawText,detectedClass);

      state.scan.recognizedMods = findRecognizedMods(rawText,detectedClass);

      populateRecognizedClasses(detectedClass);
      populateRecognizedBases(detectedClass,recognizedBase?.id || '');

      $('recognizedItemLevel').value = findRecognizedItemLevel(rawText);
      $('ocrRawText').textContent = rawText || 'Kein Text erkannt.';

      renderRecognizedMods();

      $('ocrProgressBar').style.width = '100%';
      $('imageStatus').className = rawText.trim() ? 'status' : 'status warn';
      $('imageStatus').textContent = rawText.trim()
        ? `Erkennung abgeschlossen. ${state.scan.recognizedMods.length} mögliche Affixe gefunden. Bitte Ergebnis prüfen.`
        : 'Kein verwertbarer Text erkannt. Fotografiere das Item näher, gerade und ohne Spiegelungen.';

      $('scanResult').hidden = false;
    } catch(error){
      console.error('OCR failed',error);

      $('imageStatus').className = 'status warn';
      $('imageStatus').textContent = `Texterkennung fehlgeschlagen: ${error?.message || 'unbekannter Fehler'}`;
      $('ocrProgressBar').style.width = '0%';
      $('scanResult').hidden = false;

      populateRecognizedClasses($('itemClass').value || 'Speer');
      populateRecognizedBases($('itemClass').value || 'Speer');

      $('recognizedItemLevel').value = Number($('ilevel').value) || 1;
      $('ocrRawText').textContent = String(error?.stack || error?.message || error);

      state.scan.recognizedMods = [];
      state.scan.selectedModIds = new Set();
      renderRecognizedMods();
    }
  }

  function applyScan(){
    const itemClass = $('recognizedClass').value;
    const category = DATA.recognition?.categoryByClass?.[itemClass] || 'weapon';
    const baseId = $('recognizedBase').value;
    const base = (DATA.baseItems[itemClass] || []).find(item => item.id === baseId);

    $('category').value = category;
    renderClassOptions();
    $('itemClass').value = itemClass;
    renderBaseOptions();

    if(base){
      $('basePicker').dataset.baseId = base.id;
      $('basePickerName').textContent = base.name;
    }

    $('ilevel').value = Math.min(100,Math.max(1,Number($('recognizedItemLevel').value) || 1));

    state.prefix = [null,null,null];
    state.suffix = [null,null,null];

    state.scan.recognizedMods
      .filter(item => state.scan.selectedModIds.has(item.mod.id))
      .forEach(({type,mod}) => {
        const index = state[type].findIndex(value => !value);
        if(index >= 0 && index < 3){
          state[type][index] = mod;
        }
      });

    const prefixCount = state.prefix.filter(Boolean).length;
    const suffixCount = state.suffix.filter(Boolean).length;

    if(prefixCount + suffixCount === 0){
      $('rarity').value = 'normal';
    } else if(prefixCount <= 1 && suffixCount <= 1){
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
  function bindEvents(){
    $('newProjectBtn').addEventListener('click', () => switchView('craft'));
    $('quickCraftBtn').addEventListener('click', () => switchView('craft'));
    $('quickCaptureBtn').addEventListener('click', () => {resetScanView();openSheet('captureSheet');});
    $('captureBtn').addEventListener('click', () => {resetScanView();openSheet('captureSheet');});
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
    $('recognizedClass').addEventListener('change',()=>populateRecognizedBases($('recognizedClass').value));
    $('scanAgainBtn').addEventListener('click', resetScanView);
    $('applyScanBtn').addEventListener('click', applyScan);

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
