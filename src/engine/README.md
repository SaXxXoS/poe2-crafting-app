# Crafting Engine Core: Item State

Dieser Meilenstein definiert das stabile, datengetriebene Zustandsfundament der ExileForge-Crafting-Engine. Er implementiert keine Crafting-Mechanik.

## Modell

`itemId`, `baseTypeId` und `itemClassId` sind technische Identitäten. `itemId` bleibt über Revisionen stabil. Sichtbare Namen und Modtexte sind ausdrücklich keine Identität und gehören nicht in den Engine-Zustand.

Der Item State enthält getrennte Listen für reguläre Präfixe und Suffixe sowie implizite, crafted und desecrated Modifier. Diese Trennung entspricht den vorhandenen App-Daten: reguläre Affixe verwenden `prefix`/`suffix`, während spezielle Quellen als getrennte Crafting-Datensätze vorliegen. Crafted- und desecrated Instanzen behalten ebenfalls ihren technischen `prefix`- oder `suffix`-Generation-Type; ihre Listen kennzeichnen die besondere Quelle und erfinden keinen zusätzlichen Generation Type. `displayTier` ist itemklassenspezifisch und ersetzt niemals `technicalTier`.

`sockets` wird als unveränderliche, derzeit ungeregelte Liste bewahrt. Aus den vorhandenen generierten Daten lassen sich für diesen Meilenstein keine sicheren Socket-Regeln ableiten.

## Unveränderlichkeit und Revisionen

Factories kopieren Eingaben defensiv und frieren alle verschachtelten Strukturen ein. `reviseItemState` erzeugt einen neuen Zustand, hält die Identität stabil und erhöht `revision`; der vorherige Zustand wird nicht verändert. Konkrete Aktionen und ihre History-Einträge werden erst in einem späteren Meilenstein ergänzt.

`history` besitzt bereits ein validiertes neutrales Format aus Sequenz, vorheriger/nächster Revision, technischen Aktions-IDs, Input, Resultat und Metadaten. Die Factory erfindet keine Aktion und erzeugt deshalb keinen automatischen Eintrag. Ein späterer Initialisierer darf den reservierten internen Typ `engine.item.created` verwenden.

## Validierung und Fehler

Die zentrale Validierung prüft Schema, technische IDs, Item-Level 1–86 über die bestehende zentrale Konfiguration, Rarity, Revision, Modifier-Kategorien, technische Stat-/Wertstrukturen, eindeutige Instanz-IDs und History-Referenzen. Fehler sind `EngineValidationError`-Objekte mit stabilem `code`, `message`, `path` und `details`.

Unbekannte fachliche Felder werden abgelehnt. Erweiterbare beschreibende Daten bleiben unter `metadata` verlustfrei erhalten und werden nicht als Engine-Regeln interpretiert.

## Deterministische Serialisierung

Die Serialisierung sortiert Objektschlüssel kanonisch, erhält aber fachlich relevante Array-Reihenfolgen. Sie erzeugt weder IDs noch Zeitstempel, Pfade oder Zufallswerte. Ein validierter Serialize/Deserialize-Roundtrip ist verlustfrei.

## Bewusst offen

Nicht implementiert sind Affix-Limits, Eligible-Mod-Auswahl, Gewichtsauflösung, RNG, Währungen, Essenzen, Omen, konkrete Aktionen, Planner, Simulator und Wahrscheinlichkeiten. Insbesondere maximale Präfix-/Suffixzahlen, Socket-Regeln und Sonderfälle einzelner Itemarten werden erst ergänzt, wenn sie aus strukturierten Regeln sicher ableitbar sind.

## Modifier Catalog und technische Rule Sets

Der Catalog Adapter liest `generated/poe2db/app/index.json`, `bases.json`, `mods.json` und `affix-groups.json` und erzeugt ausschließlich einen kompakten unveränderlichen In-Memory-Index. Er schreibt keine Daten und verwendet technische Itemklassen-, Basis-, Mod- und Familien-IDs. Fehlende Domains, Flags, Tiers oder Gewichte bleiben ausdrücklich `null`; sichtbare Texte werden nicht als Identität übernommen.

Ein unveränderlicher Rule Context verbindet Item State, Catalog, technische Zielinformationen in `actionContext` und beschreibende Metadaten. Die zentrale Auswertung führt in stabiler Reihenfolge Identity-, Modifier-Reference-, Domain-, Generation-Type-, Item-Level- sowie Tag/Weight-Structure-Regeln aus. Ergebnisse enthalten deterministisch sortierte strukturierte Fehler und Warnungen mit Rule-Set-Zuordnung.

`generationType` beschreibt weiterhin die technische Position `prefix` oder `suffix`; `source` bewahrt davon unabhängig vorhandene Kennzeichnungen wie crafted oder desecration. `technicalTier` bleibt getrennt von den itemklassenspezifischen `displayTiers`. Gewichte einschließlich `0` werden nur strukturell geprüft und niemals ausgelost.

## Eligible Modifier Resolution v1

`resolveEligibleModifiers` ordnet jeden Modifier aus dem bestehenden Catalog Adapter für einen konkreten Item State exakt einer Liste zu: `eligible` bedeutet, dass alle implementierten Pflichtregeln bestanden sind; `ineligible` bedeutet mindestens einen sicheren Ausschluss; `unresolved` bedeutet fehlende oder nicht sicher interpretierbare entscheidungsrelevante Daten. Katalogfehler haben Vorrang, danach folgen sichere Ausschlüsse, ungelöste Regeln und zuletzt Eligibility. Jeder Kandidat enthält stabil sortierte technische Reasons mit `pass`, `fail` oder `unresolved`.

Der Standardmodus `regular` akzeptiert nur technische Prefix-/Suffix-Typen und bekannte reguläre Quellen. Crafted-, Essence- und Desecrated-Quellen werden getrennt vom Generation Type bewahrt und nicht in den regulären Pool umgedeutet. Itemklasse, Basistyp, Item-Level, strukturierte Basistags, geordnete Spawn-/Generation-Weights, vorhandene Mod-IDs und technische Modgruppen werden ausgewertet. Die Rule-Set-Auswertung bleibt die technische Validierungsquelle für Katalogstruktur, Domains, Generation Types und Gewichte.

Fehlende Domains blockieren im regulären Standardmodus nicht, wenn die vorhandene Klassen- und Gewichtsstruktur die Poolzuordnung vollständig bestimmt; ein Caller kann eine Domain mit `requireDomain` ausdrücklich zur Pflicht machen. Vorhandene unbekannte Domains bleiben immer `unresolved`. Fehlende Basistags oder Gewichtsstrukturen sind ebenfalls ungelöst, ein anwendbares Gewicht `0` und ein expliziter Tag-Mismatch sind sichere Ausschlüsse. Fehlende Modgruppen werden bei vorhandenen Affixen nicht als Konfliktfreiheit interpretiert.

`getDefaultCapacityRules()` stellt die fachlich freigegebenen ExileForge-Standards bereit: Magic Items erlauben maximal ein Prefix und ein Suffix, Rare Items maximal drei Prefixes und drei Suffixes. Für Normal Items wird keine Grenze erfunden. Node- und Browser-Entry exportieren dieselbe unveränderliche API. Aufrufer müssen die zur Item-Rarity gehörende `{ prefix, suffix }`-Regel bewusst als `capacityRules` übergeben; Engine-Funktionen wenden sie niemals implizit an. Ohne explizite Regeln bleiben sonst zulässige Prefix- und Suffixkandidaten weiterhin `unresolved`. Volle Prefix- und Suffixseiten werden unabhängig voneinander geprüft. `technicalTier` bleibt unverändert; `displayTier` wird separat und ausschließlich für die technische Itemklasse aufgelöst.

Die Statuspriorität lautet: struktureller Engine-/Katalogfehler, sicherer Ausschluss, ungelöste Pflichtregel, eligible. Da es nur die drei Kandidatenlisten gibt, erscheint ein Kandidat mit Katalogfehler genau einmal unter `unresolved`, während `valid=false` und `errors` den strukturellen Fehler auf Ergebnisebene sichtbar machen. Gleichzeitig vorhandene sichere Ausschluss-Reasons bleiben am Kandidaten erhalten und werden nicht als normaler Ausschluss ausgegeben oder verschleiert.

Eingaben werden nicht mutiert, das Ergebnis wird rekursiv eingefroren und alle Listen werden nach technischen Feldern deterministisch sortiert. Technische Strings werden localeunabhängig in JavaScript-Code-Unit-Reihenfolge verglichen; `localeCompare` und `Intl.Collator` werden nicht verwendet. Kandidaten, Reasons, Errors und Warnings besitzen stabile technische Tie-Breaker, sodass fachlich identische Eingaben trotz unterschiedlicher Einfügereihenfolge bytegenau identische serialisierte Ergebnisse erzeugen. Der Resolver implementiert weder Crafting-Aktionen noch Mutation, RNG, gewichtete Auswahl, Wahrscheinlichkeiten, Targeting, Meta-Crafts, Planner, Simulator oder UI. Spätere Aktionen und RNG müssen auf dieser nachvollziehbaren Kandidatenauflösung aufbauen.

## Deterministic Weight Selection v1

`selectWeightedModifier(request, options)` konsumiert genau einen bereits vollständig aufgelösten, ausführbaren `modifier-addition`-Selection-Request mit `count: 1`. Die Funktion liest keinen Catalog oder Item State, ruft weder Actions noch Eligibility erneut auf und verändert keine Eingabe. Removal, Replacement, andere Counts, leere Pools und nicht ausführbare Requests bleiben ausdrücklich außerhalb dieses Meilensteins.

Der effektive Auswahlwert ist ausschließlich das bereits vom Resolver für Item und Basistags bestimmte Feld `candidate.applicableWeight.spawn`. Rohe Spawn-/Generation-Weight-Listen, `applicableWeight.generation`, sichtbare Tiers und Candidate Counts werden nicht neu interpretiert, multipliziert oder normalisiert. Endliche Gewichte ab `0` sind strukturell gültig; Gewicht `0` bleibt im Request, kann aber nie ausgewählt werden. Die positive Gesamtsumme muss endlich bleiben.

Die Auswahl verwendet den Zielwert `randomValue * totalWeight` im halboffenen Intervall `[0, totalWeight)` und durchläuft Candidates unverändert in Request-Reihenfolge. Ausgewählt wird der erste positive Candidate mit `targetWeight < cumulativeWeight`. Die bereits deterministische Request-Reihenfolge ist damit Teil der Auswahlsemantik; das Modul sortiert oder kanonisiert den Pool nicht erneut.

Für reproduzierbare Produktionsaufrufe erzeugt `createSeededRandom(seed)` einen expliziten unveränderlichen Mulberry32-Zustand aus einem unsigned 32-Bit-Integer. `selectWeightedModifier` akzeptiert diesen als `options.rngState` und gibt `nextRngState` zur expliziten Fortsetzung zurück. Alternativ kann ein Caller für isolierte Tests `options.random` injizieren; dessen Ergebnis muss endlich und in `[0, 1)` liegen. Es gibt keine globale RNG-Instanz, Zeit-, Crypto- oder `Math.random`-Quelle. Mulberry32 ist eine kleine plattformunabhängige technische PRNG und nicht kryptographisch sicher.

Das tief eingefrorene Resultat besitzt `selected`, `inapplicable` oder `error`, technische Request-Referenzen, ausgewählten Candidate und Index, Zufalls-/Gewichtswerte, RNG-Zustände sowie strukturierte Reasons und Errors. Fehlercodes unterscheiden Request-Typ, Executability, Count, Pool, Candidate-Identität, effektive Gewichte, Seed/RNG und interne Auswahl-Invarianten. Dieser Meilenstein führt keinen Mutation Plan aus, wendet keinen Modifier an und implementiert weder Simulator, Planner, Monte Carlo, Wahrscheinlichkeitsanzeige noch UI.

```js
const rngState = createSeededRandom(42);
const selected = selectWeightedModifier(action.selectionRequests[0], { rngState });
// selected.selectedCandidate ist nur das unveränderliche technische Auswahlergebnis.
```

## Single-Step Simulator v1

`simulateCraftingStep({ itemState, actionResult, selectionResults })` führt atomar genau einen bereits vorbereiteten und `applicable` bewerteten Mutation Plan aus. Die Funktion wertet keine Action neu aus, löst keine Kandidaten oder Regeln auf, liest keinen Catalog und erzeugt weder RNG noch Weight Selection. Das Action Result bindet Item-ID, Basistyp, Itemklasse, Rarity und Revision über den vorhandenen kanonischen Addition-Request-Key an den Eingangs-State.

Unterstützt sind höchstens ein expliziter `set-rarity`-Schritt, `preserve-existing-modifiers` und genau ein `add-selected-modifier` mit einem ausführbaren Addition Request von `count: 1`. Bei einer kombinierten Änderung steht der Rarity-Schritt im Mutation Plan vor der Addition. Removal, Replacement, Alteration und Chaos bleiben ungelöst; Transmutation verwendet dagegen den autoritativen `selectionCount: 1`. Unbekannte Operationen werden niemals teilweise angewendet.

Für eine Addition muss genau ein `selected` Selection Result denselben Request und `deterministicKey` referenzieren. Index, Modifier-ID und vollständiger technischer Candidate müssen mit dem ursprünglichen Request übereinstimmen; zusätzliche oder mehrfach verwendete Selection Results werden abgelehnt. Der Simulator überträgt vorhandene technische Candidate-Felder in eine reguläre Modifier-Instanz, erfindet aber keine Roll- oder Displaywerte und führt weder Capacity-, Modgruppen- noch Eligibility-Regeln erneut aus.

Eine erfolgreiche Simulation erzeugt über die zentrale Item-State-Revision genau ein neues, rekursiv eingefrorenes Item mit `revision + 1`, unabhängig von der Zahl unterstützter Planoperationen. Das Ursprungsitem, Action Result, Requests, Candidates, Selection Results und RNG-Metadaten bleiben unverändert. Bei jedem Fehler oder nicht ausführbaren Plan sind `resultingItemState` null und `appliedOperations` leer; es gibt keinen sichtbaren Zwischenzustand.

```js
const selection = selectWeightedModifier(action.selectionRequests[0], { rngState });
const simulation = simulateCraftingStep({ itemState, actionResult: action, selectionResults: [selection] });
// simulation.resultingItemState ist eine neue Revision; action und itemState bleiben unverändert.
```

Der Simulator implementiert keine Aktionsketten, automatische Evaluation, weitere Auswahl, Removal-/Replacement-Ausführung, Planner, Monte Carlo, Wahrscheinlichkeiten, UI, Inventar, Persistenz, Currency-Verbrauch oder Kosten.

## Deterministic Crafting Path Planner v1

`planCraftingPaths({ initialItemState, catalog, allowedActions, maxDepth, maxPaths, targetPredicate, actionContext, actionContexts })` untersucht begrenzt und deterministisch mögliche Folgen der bestehenden Actions Augmentation, Regal und Exalted. Der Planner verwendet die vorhandene Action Evaluation, enumeriert ausschließlich positiv gewichtete Candidates aus deren Selection Requests und wendet jeden konkreten Ausgang über den Single-Step-Simulator an. Er führt keine zufällige Auswahl aus.

Die Suche ist eine stabile Breadth-First Search. Zielpfade, geringere Tiefe, höhere kumulative Pfadwahrscheinlichkeit, Action-Reihenfolge und technische Modifier-ID bilden die Tie-Break-Reihenfolge. Fachlich identische Itemzustände werden unabhängig von Revision und technischen Instanz-IDs nicht erneut an einer gleichen oder schlechteren Suchposition expandiert. `maxDepth` ist auf 8 und `maxPaths` auf 1.000 begrenzt; niedrigere Caller-Grenzen werden strikt eingehalten.

`error`, `inapplicable` und `unresolved` bleiben getrennte Engine-Zustände. Ein Engine-Fehler beendet die Planung sichtbar, während fachlich nicht anwendbare Zweige übersprungen und ungelöste Zweige diagnostiziert, aber niemals automatisch ausgewählt werden. Ergebnisse und Zwischenzustände sind rekursiv unveränderlich und enthalten keine Zeit-, RNG- oder globale Cache-Daten.

Dieser Planner ist keine UI-Integration, keine Preisoptimierung, kein Monte-Carlo-Verfahren und unterstützt weder Removal noch Replacement oder weitere Crafting Actions.

## Crafting Actions Core v1

Die Action-Schicht trennt unveränderliche **Action Definitions**, deterministische **Action Applicability** und einen noch nicht ausgeführten **Action Execution Plan**. Die Registry verwendet ausschließlich stabile technische IDs: `currency:transmutation`, `currency:augmentation`, `currency:alteration`, `currency:regal`, `currency:exalted` und `currency:chaos`. Definitionen beschreiben Rarity-Vertrag, Operationstyp, Auswahl-/Entfernungsbedarf und bekannte Grenzen; Anzeigenamen und Übersetzungen besitzen keine technische Bedeutung.

`evaluateCraftingAction` endet in genau einem Status. Die Priorität lautet `error` vor `inapplicable` vor `unresolved` vor `applicable`: ungültige Engine- oder Katalogstrukturen sind Fehler, sichere Ausschlüsse sind nicht anwendbar, fehlende Pflichtregeln bleiben ungelöst und nur vollständig belegte Planungen sind anwendbar. Rarity wird direkt aus dem bestehenden Item State geprüft und nicht erneut normalisiert.

Aktionen mit regulärer Modifier-Hinzufügung verwenden unmittelbar `resolveEligibleModifiers`; sie bauen weder Pool- noch Weight-Logik parallel nach. Ohne explizite `capacityRules` werden keine realen Prefix-/Suffixlimits geraten. Transmutation fügt autoritativ genau einen regulären Modifier hinzu; Annulment entfernt autoritativ genau einen gleichwahrscheinlich ausgewählten regulären Prefix- oder Suffix-Modifier. Implizite, Crafted- und Desecrated-Modifier gehören nicht zum Annulment-Pool. Alteration und Chaos benötigen caller-gelieferte `selectionCountRules` und `removalRules`. Diese externen Regeln sind explizite Eingaben, werden validiert und niemals in Definitionen oder Engine-Konstanten übernommen.

Ein **Selection Request** enthält stabil sortierte technische Kandidaten, rohe nicht normalisierte Gewichte, Count, Constraints, eine technische deterministische ID und eine kompakte Referenz auf das Resolver-Ergebnis. Er enthält weder einen ausgewählten Modifier noch Wahrscheinlichkeit, normalisierte Gewichte, RNG oder Zeitstempel. Addition Requests sind vollständig strukturiert; Removal Requests beschreiben ausschließlich eine spätere Auswahl aus vorhandenen regulären Instanzen.

Der **Mutation Plan** beschreibt mit `applied: false` ausschließlich beabsichtigte Schritte wie `set-rarity`, `preserve-existing-modifiers`, `remove-selected-modifier`, `clear-random-modifiers`, `add-selected-modifier` oder `replace-random-modifiers`. Er mutiert den Item State nicht und gibt keinen scheinbar ausgeführten Folgezustand zurück. Transmutation ist ausschließlich für ein leeres Normal-Item anwendbar, plant normal→magic und fügt mit dem autoritativen `selectionCount: 1` exakt ein reguläres Prefix oder Suffix hinzu; caller-gelieferte Count-Overrides bestimmen diese Anzahl nicht. Die bestehende Magic-Capacity muss ausdrücklich bereitgestellt werden, ohne eine Normal-Capacity einzuführen oder anzunehmen. Annulment ist nur mit mindestens einem regulären expliziten Modifier anwendbar, verändert die Seltenheit nicht und entfernt nach einer separaten deterministischen Auswahl exakt die gewählte Instanz. Nicht erfolgreiche Resultate bleiben ohne partiellen Ergebnis-State, Rarity-Wechsel, Revisionserhöhung, hinzugefügten oder entfernten Modifier. Augmentation erhält ein Magic Item und plant genau eine Addition; Regal plant magic→rare plus Addition; Exalted plant eine Addition auf Rare.

Alteration und Chaos verwenden bewusst den vollständig deferred Replacement-Vertrag: Der aktuelle Item State enthält noch Modifier, die vor der späteren Addition entfernt werden sollen, und ist deshalb keine fachlich korrekte Resolver-Grundlage. Solange kein expliziter unveränderlicher Post-Removal-Projektionszustand existiert, wird der Eligible Modifier Resolver für diese Aktionen nicht aufgerufen, `eligibilityResult` bleibt `null`, und es entsteht kein Addition Selection Request. Ein caller-belegter Removal Request darf den späteren Entfernungsschritt mit `executable: false` beschreiben; die Action bleibt unabhängig von Count- und Capacity-Regeln `unresolved`. Duplicate-, Modgruppen- und Capacity-Regeln werden dadurch weder gegen den falschen Ausgangszustand ausgewertet noch parallel umgangen. Im Mutation Plan steht der Clear-Schritt deterministisch vor dem deferred Replacement-Schritt.

Definitionen, Bewertungen, Reasons, Selection Requests, Mutation Plans und Summaries sind defensiv kopiert und rekursiv eingefroren. Technische Sortierung verwendet JavaScript-Code-Unit-Reihenfolge ohne `localeCompare` oder `Intl.Collator`; identische Eingaben erzeugen bytegenau identische Ergebnisse. Unterstützte Single-Step-Aktionen werden ausschließlich über ihre validierten Selection Requests und den Simulator ausgeführt; nicht unterstützte Replacement-Schritte bleiben ausdrücklich `unresolved`.

### Öffentliche Action-API und Counts

Die öffentliche API exportiert `getCraftingActionDefinition(actionId)`, `listCraftingActionDefinitions()`, `evaluateCraftingAction(...)` und `ENGINE_ACTION_CODES` über `src/engine/index.mjs`.

| Action | `selectionCount` | `removalCount` |
| --- | ---: | ---: |
| `currency:transmutation` | `1` | `0` |
| `currency:annulment` | `0` | `1` |
| `currency:augmentation` | `1` | `0` |
| `currency:alteration` | `null` | `null` |
| `currency:regal` | `1` | `0` |
| `currency:exalted` | `1` | `0` |
| `currency:chaos` | `null` | `null` |

`null` bedeutet technisch unbekannt und ausdrücklich nicht `0`; `0` ist ein expliziter Count. Fehlen notwendige Count Rules, bleibt die Action `unresolved`. Ungültige Count Rules führen zu `error`.

Jede Action mit `requiresCatalog=true` verlangt unabhängig von ihrem Ausführungspfad einen strukturell gültigen Katalog. Das gilt auch für deferred Replacement-Aktionen: Alteration und Chaos validieren den Katalog, ohne Eligibility gegen das Ausgangsitem auszuführen. Ein struktureller Katalogfehler führt zu `status: "error"`, `valid: false`, einem nachvollziehbaren `ENGINE_ACTION_CATALOG_INVALID`, leeren Selection Requests und einem leeren Mutation Plan.

Der Catalog Adapter validiert und normalisiert rohe Dokumente und erzeugt daraus den normalisierten Engine-Catalog. Dessen gemeinsame reine Strukturvalidierung wird anschließend von Adapter, Rule Evaluation, Eligible Modifier Resolver und Actions wiederverwendet. Sie prüft technische Typen, Nullability, Referenzen, Tiers, Sources, Flags und rohe Weight-Strukturen, führt aber weder Eligibility, Tag-Matching, Capacity, Item-Konflikte, Poolfilterung noch RNG aus. `source` ist im normalisierten Catalog ausschließlich `null` oder eine nicht leere technische Zeichenfolge. Falsche Datentypen und nicht-finite Zahlen führen vor einer Kandidatenauswertung zu strukturierten Fehlern; sie dürfen keine ungefangenen Resolver-TypeErrors auslösen.

Der `deterministicKey` eines Selection Requests ist die kanonische Serialisierung ausschließlich seiner technischen Auswahlsemantik. Sie umfasst im unterstützten Vertrag Action und Request-Typ, Itemkontext, Counts, auswählbaren Kandidatenpool, technische Tieridentität, Constraints, Capacity-Informationen, Weighting- und Replacement-Vertrag sowie relevante rohe Spawn- und Generation-Weights. Diagnostische Resolver-Zähler, sicher ausgeschlossene Katalogmods, Reasons, Meldungstexte und `displayTier` sind keine technische Request-Identität und gehören nicht in den Key. Zusätzliche sicher ineligible Katalogmods verändern Key und ID daher nicht, wenn der auswählbare Request identisch bleibt.

Objektkeys werden rekursiv und localeunabhängig sortiert. `undefined`, `NaN` und positive oder negative Infinity sind in kanonischen Payloads unzulässig und erzeugen einen strukturierten technischen Fehler; `null`, `0`, `false`, leere Werte und fehlende Properties bleiben unterscheidbar. Die Payload enthält weder Zufalls- noch Zeitwerte und ist deterministisch, aber nicht kryptografisch. Semantisch identische Requests erzeugen innerhalb dieses Vertrags bytegleiche Keys und IDs; semantisch unterschiedliche Requests erzeugen unterschiedliche Keys und IDs. Die Request-ID wird deterministisch aus dem Key abgeleitet. Pro Request-Typ erzeugt eine Evaluation im aktuellen Vertrag höchstens einen Request, sodass Mutation-Plan-Referenzen eindeutig bleiben.
