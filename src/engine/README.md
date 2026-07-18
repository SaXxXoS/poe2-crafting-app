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

Eligible Modifier Resolution folgt erst in einem späteren Meilenstein. Noch fehlen insbesondere Affix-Slot-Limits, Modgruppen-Exklusivität, vorhandene-Affix-Konflikte, Targeting, Meta-Crafting, konkrete Crafting-Wirkungen, Wahrscheinlichkeiten und jede Form von Auswahl oder RNG.
