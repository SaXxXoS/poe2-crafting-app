function element(document, tagName, className = "") {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  return node;
}

function textElement(document, tagName, value, className = "") {
  const node = element(document, tagName, className);
  node.textContent = String(value);
  return node;
}

function summaryStat(document, label, value) {
  const node = element(document, "div", "single-step-stat");
  node.append(
    textElement(document, "small", label),
    textElement(document, "b", value)
  );
  return node;
}

export function renderSingleStepResult({
  document,
  container,
  result,
  currentItemState,
  actionLabel,
  modifierDisplay
}) {
  container.replaceChildren();
  container.hidden = !result;
  if (!result) return;

  const current = result.itemState || currentItemState;
  const previous = result.previousItemState || current;
  const candidate = result.selectionResult?.selectedCandidate || null;
  const removedModifier = result.simulationResult?.removedModifier || null;
  const statusClass = result.status === "successful" ? "success" : result.status === "error" ? "error" : "warn";
  const statusLabels = { successful: "Erfolgreich", inapplicable: "Nicht anwendbar", unresolved: "Nicht auflösbar", error: "Fehler" };
  const statusLabel = statusLabels[result.status] || "Unbekannter Status";
  const rarityLabels = { normal: "Normal", magic: "Magisch", rare: "Selten" };

  const status = element(document, "div", `status ${statusClass}`);
  status.append(textElement(document, "strong", `${actionLabel} · ${statusLabel}`));
  status.append(element(document, "br"));
  status.append(textElement(document, "span", result.message));
  const summary = element(document, "div", "single-step-summary");
  summary.append(
    summaryStat(document, "Seltenheit", `${rarityLabels[previous?.rarity] || "–"} → ${rarityLabels[current?.rarity] || "–"}`),
    summaryStat(document, "Revision", `${previous?.revision ?? "–"} → ${current?.revision ?? "–"}`),
    summaryStat(document, "Präfixe", `${previous?.prefixModifiers?.length ?? 0} → ${current?.prefixModifiers?.length ?? 0}`),
    summaryStat(document, "Suffixe", `${previous?.suffixModifiers?.length ?? 0} → ${current?.suffixModifiers?.length ?? 0}`)
  );

  let selected;
  if (removedModifier && candidate) {
    selected = element(document, "div", "single-step-mod single-step-mod-removed");
    const affixType = removedModifier.generationType === "prefix" ? "Präfix" : "Suffix";
    const tier = removedModifier.displayTier ? `T${removedModifier.displayTier}` : "Tier nicht verfügbar";
    selected.append(
      textElement(document, "small", `Entfernter ${affixType} · ${tier}`),
      textElement(document, "b", modifierDisplay(removedModifier.modId)),
      textElement(document, "small", "Dieser reguläre Modifikator wurde entfernt.")
    );
  } else if (candidate) {
    selected = element(document, "div", "single-step-mod");
    const affixType = candidate.generationType === "prefix" ? "Präfix" : "Suffix";
    const tier = candidate.displayTier ? `T${candidate.displayTier}` : "Tier nicht verfügbar";
    selected.append(
      textElement(document, "small", `${affixType} · ${tier}`),
      textElement(document, "b", modifierDisplay(candidate.modifierId)),
      textElement(document, "small", `Gewicht: ${candidate.applicableWeight?.spawn ?? "Nicht verfügbar"} · Wahrscheinlichkeit: Nicht verfügbar`)
    );
  } else {
    selected = textElement(document, "div", "Kein Modifikator wurde verändert.", "status");
  }

  container.append(status, summary, selected);
}
