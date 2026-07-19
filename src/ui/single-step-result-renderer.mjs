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
  const statusClass = result.status === "successful" ? "success" : result.status === "error" ? "error" : "warn";
  const statusLabel = result.status === "successful" ? "Erfolgreich" : result.status;
  const rarityLabels = { normal: "Normal", magic: "Magisch", rare: "Selten" };

  const status = element(document, "div", `status ${statusClass}`);
  status.append(textElement(document, "strong", `${actionLabel} · ${statusLabel}`));
  status.append(element(document, "br"));
  status.append(textElement(document, "span", result.message));
  if (result.reasonCode) {
    status.append(element(document, "br"));
    status.append(textElement(document, "span", `Code: ${result.reasonCode}`));
  }

  const summary = element(document, "div", "single-step-summary");
  summary.append(
    summaryStat(document, "Rarity", `${rarityLabels[previous?.rarity] || "–"} → ${rarityLabels[current?.rarity] || "–"}`),
    summaryStat(document, "Revision", `${previous?.revision ?? "–"} → ${current?.revision ?? "–"}`),
    summaryStat(document, "Präfixe", `${previous?.prefixModifiers?.length ?? 0} → ${current?.prefixModifiers?.length ?? 0}`),
    summaryStat(document, "Suffixe", `${previous?.suffixModifiers?.length ?? 0} → ${current?.suffixModifiers?.length ?? 0}`)
  );

  let selected;
  if (candidate) {
    selected = element(document, "div", "single-step-mod");
    const affixType = candidate.generationType === "prefix" ? "Präfix" : "Suffix";
    const tier = candidate.displayTier ? `T${candidate.displayTier}` : "Tier nicht verfügbar";
    selected.append(
      textElement(document, "small", `${affixType} · ${tier}`),
      textElement(document, "b", modifierDisplay(candidate.modifierId)),
      textElement(document, "small", `Gewicht: ${candidate.applicableWeight?.spawn ?? "Nicht verfügbar"} · Wahrscheinlichkeit: Nicht verfügbar`)
    );
  } else {
    selected = textElement(document, "div", "Kein Modifier hinzugefügt.", "status");
  }

  container.append(status, summary, selected);
}
