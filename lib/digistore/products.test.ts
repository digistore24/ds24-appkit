// Copyright (c) 2026 Digistore24 Inc, St. Petersburg, USA
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { notChecked } from "@/lib/test-not-checked";
import {
  allProducts,
  findProduct,
  getProduct,
  productsByKind,
  hasProductId,
  productId,
  productByDs24Id,
  unknownKindProblems,
  sellFieldProblems,
  isSold,
  sellableProducts,
  PRODUCT_KINDS,
  productIdsOf,
  productLanguages,
  checkoutProductFor,
  formatPrice,
  intervalKey,
  type ProductDef,
} from "./products";

// Ein Key AUS der Registry, nicht einer aus dem Template.
//
// Die Registry ist die Datei, die der Kunde umbaut — das steht in ihrem eigenen
// `_comment`, und wer nur Abos verkauft, loescht die Token-Pakete daraus. Ein
// Test, der auf "pro" oder "starter" festgenagelt ist, wird dann rot und sieht
// aus wie ein Fehler in der App. Geprueft gehoert die FORM dessen, was die
// Registry haelt, nicht ihr Auslieferungszustand.
//
// `null` bei leerer Registry: auch das ist ein legitimer Zwischenstand — die
// Planseite hat einen EmptyState genau dafuer.
function someProduct(kind?: ProductDef["kind"]): ProductDef | null {
  const all = kind ? productsByKind(kind) : allProducts();
  return all[0] ?? null;
}

describe("Produkt-Registry", () => {
  it("reads products including the resolved key", () => {
    const all = allProducts();
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      expect(p.key).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(["subscription", "token", "one_time"]).toContain(p.kind);
    }
  });

  it("liefert ein Produkt oder wirft bei unbekanntem key", () => {
    const any = someProduct();
    if (any) expect(getProduct(any.key).key).toBe(any.key);
    expect(() => getProduct("gibtsnicht")).toThrow();
  });

  it("jedes Token-Paket hat ein Guthaben", () => {
    // Die Bedingung, an der lib/tokens/packages.ts sonst wirft: ein
    // kind="token" ohne `credits` ist ein Paket, das nichts gutschreibt.
    for (const pkg of productsByKind("token")) {
      expect(pkg.credits, pkg.key).toBeGreaterThan(0);
    }
  });

  it("findProduct liefert null statt zu werfen — auch fuer Prototyp-Keys", () => {
    const any = someProduct();
    if (any) expect(findProduct(any.key)?.key).toBe(any.key);
    // Der Fall, fuer den es die Funktion gibt: ein Key, den die Registry nicht
    // (mehr) fuehrt, weil er umbenannt oder geloescht wurde.
    expect(findProduct("gibtsnicht")).toBeNull();
    // Der Object.hasOwn-Schutz gilt hier genauso wie in getProduct().
    for (const key of ["constructor", "__proto__", "toString", "valueOf"]) {
      expect(findProduct(key)).toBeNull();
    }
  });

  it("filtert nach Typ", () => {
    const tokens = productsByKind("token");
    expect(tokens.every((p) => p.kind === "token")).toBe(true);
    const subs = productsByKind("subscription");
    expect(subs.every((p) => p.kind === "subscription")).toBe(true);
  });

  it("meldet fehlende productId und wirft bei productId()", () => {
    // Vor dem Sync sind die productIds Platzhalter (null) — danach nicht mehr,
    // denn sync-products.mjs schreibt sie in genau diese Datei zurueck. Also
    // wird die Verknuepfung geprueft, nicht der eine oder andere Zustand:
    // fehlt die id, muss productId() werfen und auf den Sync zeigen.
    for (const product of allProducts()) {
      if (hasProductId(product.key)) {
        expect(productId(product.key)).toBeTruthy();
      } else {
        expect(() => productId(product.key)).toThrow(/ds24-sync/);
      }
    }
  });
});

describe("Preis-Anzeige", () => {
  const abo: ProductDef = {
    key: "test",
    name: "Test",
    kind: "subscription",
    billingInterval: "1_month",
    priceCents: 1900,
    currency: "EUR",
  };

  it("schreibt den Preis in der Konvention der Sprache", () => {
    // Same amount, same currency — only the formatting differs
    // sich. Umgerechnet wird NIE (abgerechnet wird, was bei DS24 steht).
    const de = formatPrice(abo, "de-DE");
    const en = formatPrice(abo, "en-US");
    expect(de).toContain("19");
    expect(en).toContain("19");
    expect(de).not.toBe(en);
  });

  it("liefert null ohne Preis — die Oberflaeche zeigt dann „auf Anfrage“", () => {
    expect(formatPrice({ ...abo, priceCents: undefined }, "de-DE")).toBeNull();
  });

  it("returns the interval as a translation key", () => {
    expect(intervalKey(abo)).toBe("perMonth");
    expect(intervalKey({ ...abo, billingInterval: "12_month" })).toBe("perYear");
    expect(intervalKey({ ...abo, kind: "token" })).toBe("oneTime");
  });

  it("returns null for an unknown interval", () => {
    // The page then shows the raw value instead of leaving a blank.
    expect(intervalKey({ ...abo, billingInterval: "3_month" })).toBeNull();
  });
});

// Ein Digistore24-Produkt traegt GENAU EINE Sprache, und diese Sprache ist die
// Sprache des Bestellformulars — createBuyUrl kann sie nicht ueberschreiben.
// Eine zweisprachige App braucht deshalb zwei Produkte pro Angebot. Diese
// Tests halten die Aufloesung fest; das Begleitwissen steht in products.ts.
describe("Sprache → Digistore24-Produkt", () => {
  const zweisprachig: ProductDef = {
    key: "pro",
    name: "Pro",
    kind: "token",
    productIdByLanguage: { de: "111", en: "222" },
  };

  it("schickt jeden Kaeufer auf das Produkt SEINER Sprache", () => {
    expect(checkoutProductFor(zweisprachig, "de")).toEqual({
      productId: "111",
      language: "de",
    });
    expect(checkoutProductFor(zweisprachig, "en")).toEqual({
      productId: "222",
      language: "en",
    });
  });

  it("faellt auf die Standardsprache zurueck statt den Verkauf zu verweigern", () => {
    // Ein Angebot, das es auf Franzoesisch nicht gibt, bleibt kaufbar — der
    // Kaeufer bekommt nur ein Formular in der falschen Sprache. Die Luecke
    // meldet `node run.mjs ds24-sync`, nicht die Kasse.
    expect(checkoutProductFor(zweisprachig, "fr")?.language).toBe("de");
  });

  it("nimmt irgendein vorhandenes Produkt, wenn auch die Standardsprache fehlt", () => {
    const nurEnglisch: ProductDef = {
      key: "pro",
      name: "Pro",
      kind: "token",
      productIdByLanguage: { en: "222" },
    };
    expect(checkoutProductFor(nurEnglisch, "de")).toEqual({
      productId: "222",
      language: "en",
    });
  });

  it("antwortet null, solange gar nichts synchronisiert ist", () => {
    // "noch nicht angelegt" und "in dieser Sprache nicht verkauft" sind zwei
    // verschiedene Zustaende — nur der erste ist ein Fehler.
    const frisch: ProductDef = {
      key: "pro",
      name: "Pro",
      kind: "token",
      productIdByLanguage: { de: null, en: null },
    };
    expect(checkoutProductFor(frisch, "de")).toBeNull();
    expect(productLanguages(frisch)).toEqual([]);
  });

  it("liest die alte Ein-Produkt-Form weiter (vor Template 0.6.0)", () => {
    // Eine Registry aus der Zeit vor der Sprach-Aufteilung muss weiter
    // verkaufen, ohne dass jemand sie von Hand umbaut.
    const alt: ProductDef = {
      key: "pro",
      name: "Pro",
      kind: "token",
      language: "en",
      productId: "999",
    };
    expect(productIdsOf(alt)).toEqual({ en: "999" });
    expect(checkoutProductFor(alt, "de")?.productId).toBe("999");
  });

  it("laesst die Karte gewinnen, wenn eine Registry mitten in der Migration steht", () => {
    // Beides gesetzt: `productIdByLanguage` ist das, was ds24-sync pflegt.
    const gemischt: ProductDef = {
      key: "pro",
      name: "Pro",
      kind: "token",
      language: "de",
      productId: "alt",
      productIdByLanguage: { de: "neu", en: "222" },
    };
    expect(productIdsOf(gemischt)).toEqual({ de: "neu", en: "222" });
  });

  it("ohne Sprachangabe gilt die Standardsprache", () => {
    const ohne: ProductDef = { key: "pro", name: "Pro", kind: "token", productId: "999" };
    expect(productLanguages(ohne)).toEqual(["de"]);
  });
});

// Jede Umgebung hat ihren EIGENEN Produktsatz (dev/staging/prod) — `ds24-sync
// --env <env>` pflegt einen davon, APP_ENV waehlt zur Laufzeit
// (lib/digistore/runtime-env.ts; diese Datei bleibt pur und nimmt env als
// Parameter, Default "prod" fuer den exportierten Core).
describe("Umgebung → Produktsatz", () => {
  const beide: ProductDef = {
    key: "pro",
    name: "Pro",
    kind: "token",
    productIds: { dev: { de: "d1" }, prod: { de: "p1", en: "p2" } },
  };

  it("verkauft im eigenen Satz, sobald es einen gibt — dev sieht prod nicht", () => {
    expect(checkoutProductFor(beide, "de", "dev")?.productId).toBe("d1");
    expect(checkoutProductFor(beide, "de", "prod")?.productId).toBe("p1");
    // Isolation: die englische Sprache existiert nur in prod — der dev-Satz
    // ist nicht leer, also faellt NICHTS auf prod zurueck; der Kaeufer bekommt
    // das deutsche dev-Produkt (die normale Sprach-Kette).
    expect(checkoutProductFor(beide, "en", "dev")?.productId).toBe("d1");
    expect(productLanguages(beide, "dev")).toEqual(["de"]);
  });

  it("faellt auf den PROD-Satz zurueck, solange der eigene Satz leer ist", () => {
    // Das Verhalten von vor dem Split ("alle Umgebungen nutzen dieselben
    // Live-Produkte"): eine App, die nie `--env dev` gesynct hat, verkauft
    // lokal weiter ueber die Live-Produkte.
    const nurProd: ProductDef = {
      key: "pro",
      name: "Pro",
      kind: "token",
      productIds: { prod: { de: "p1" } },
    };
    expect(checkoutProductFor(nurProd, "de", "dev")?.productId).toBe("p1");
    expect(checkoutProductFor(nurProd, "de", "staging")?.productId).toBe("p1");
    // Auch die Legacy-Form ist "der PROD-Satz" und traegt den Fallback:
    const legacy: ProductDef = {
      key: "pro",
      name: "Pro",
      kind: "token",
      productIdByLanguage: { de: "111" },
    };
    expect(checkoutProductFor(legacy, "de", "dev")?.productId).toBe("111");
  });

  it("prod faellt NIE auf einen anderen Satz zurueck", () => {
    // Ein Live-Checkout, der mangels prod-Sync ein "[DEV]"-Produkt verkauft,
    // waere der teuerste Bug dieser Achse.
    const nurDev: ProductDef = {
      key: "pro",
      name: "Pro",
      kind: "token",
      productIds: { dev: { de: "d1" } },
    };
    expect(checkoutProductFor(nurDev, "de", "prod")).toBeNull();
    expect(productLanguages(nurDev, "prod")).toEqual([]);
  });

  it("productIdsOf liest genau den gefragten Satz, Legacy nur als prod", () => {
    expect(productIdsOf(beide, "dev")).toEqual({ de: "d1" });
    expect(productIdsOf(beide, "staging")).toEqual({});
    const legacy: ProductDef = {
      key: "pro",
      name: "Pro",
      kind: "token",
      productIdByLanguage: { de: "111" },
    };
    expect(productIdsOf(legacy, "prod")).toEqual({ de: "111" });
    expect(productIdsOf(legacy, "dev")).toEqual({});
  });
});

describe("productByDs24Id — the reverse lookup", () => {
  const synced: ProductDef[] = [
    { key: "basis", name: "Basis", kind: "subscription", productId: "111" },
    { key: "pro", name: "Pro", kind: "token", productId: "222" },
  ];
  const unsynced: ProductDef[] = [
    { key: "basis", name: "Basis", kind: "subscription", productId: null },
    { key: "pro", name: "Pro", kind: "token", productId: null },
  ];

  it("finds the offering a Digistore24 product id belongs to", () => {
    // This is what lets an ANONYMOUS purchase — one carrying no `custom` at
    // all — still record what was bought, and later become a grant.
    expect(productByDs24Id("222", synced)?.key).toBe("pro");
  });

  it("does not match an unsynced product when the payload has no id", () => {
    // THE trap. `productId` is null until `node run.mjs ds24-sync` runs. Without the
    // both-sides-non-empty guard, `p.productId === id` with two empty values
    // matches the FIRST unsynced product — granting a plan nobody bought.
    expect(productByDs24Id("", unsynced)).toBeNull();
    expect(productByDs24Id(null, unsynced)).toBeNull();
    expect(productByDs24Id(undefined, unsynced)).toBeNull();
  });

  it("does not match an unsynced product when the payload HAS an id", () => {
    // The other half of the guard: a real id must not fall onto a registry
    // entry that has none.
    expect(productByDs24Id("111", unsynced)).toBeNull();
  });

  it("returns null for an id the registry does not know", () => {
    // Unknown, never wrong. The order keeps its ds24ProductId and stays
    // recoverable once the Operator syncs and attaches it by hand.
    expect(productByDs24Id("999", synced)).toBeNull();
  });

  it("refuses to guess when two offerings share one product id", () => {
    const ambiguous: ProductDef[] = [
      { key: "a", name: "A", kind: "subscription", productId: "555" },
      { key: "b", name: "B", kind: "subscription", productId: "555" },
    ];
    expect(productByDs24Id("555", ambiguous)).toBeNull();
  });

  it("defaults to the real registry", () => {
    // Whatever the shipped config says, an empty id must never resolve.
    expect(productByDs24Id("")).toBeNull();
  });

  it("finds an offering by ANY of its language products", () => {
    // The one that costs money if it regresses: a German and an English buyer
    // arrive on two different Digistore24 products, and the IPN names the one
    // they actually bought. Matching only the first id would leave every
    // English purchase unattributed — and `orders.productKey` is never
    // reconstructed afterwards.
    const bilingual: ProductDef[] = [
      { key: "pro", name: "Pro", kind: "token", productIdByLanguage: { de: "111", en: "222" } },
      { key: "basis", name: "Basis", kind: "subscription", productIdByLanguage: { de: "333" } },
    ];
    expect(productByDs24Id("111", bilingual)?.key).toBe("pro");
    expect(productByDs24Id("222", bilingual)?.key).toBe("pro");
    expect(productByDs24Id("333", bilingual)?.key).toBe("basis");
  });

  it("does not call two languages of ONE offering ambiguous", () => {
    // Two offerings sharing an id is a refusal; two LANGUAGES of the same
    // offering are one answer, not two.
    const bilingual: ProductDef[] = [
      { key: "pro", name: "Pro", kind: "token", productIdByLanguage: { de: "111", en: "222" } },
    ];
    expect(productByDs24Id("222", bilingual)?.key).toBe("pro");
  });

  it("finds an offering by ANY of its environments' products", () => {
    // Same rule widened: a dev test purchase names the dev product id, and it
    // is still this offering. Which set it came in on is the per-environment
    // IPN connections' business, not this lookup's.
    const envs: ProductDef[] = [
      {
        key: "pro",
        name: "Pro",
        kind: "token",
        productIds: { dev: { de: "d1" }, prod: { de: "p1" } },
      },
    ];
    expect(productByDs24Id("d1", envs)?.key).toBe("pro");
    expect(productByDs24Id("p1", envs)?.key).toBe("pro");
  });

  it("does not call two environments of ONE offering ambiguous", () => {
    const both: ProductDef[] = [
      {
        key: "pro",
        name: "Pro",
        kind: "token",
        productIds: { dev: { de: "555" }, prod: { de: "555" } },
      },
    ];
    expect(productByDs24Id("555", both)?.key).toBe("pro");
  });
});

describe("unknownKindProblems — the loader's refusal", () => {
  it("names the entry, the value and the allowed kinds", () => {
    // The realistic input: a hand-edited registry with a hyphen typo. The
    // module-load check turns this into a refusal to start; here the message
    // itself is pinned so it names everything the vendor needs to fix it.
    const problems = unknownKindProblems([{ key: "kurs", kind: "one-time" }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"kurs"');
    expect(problems[0]).toContain('"one-time"');
    expect(problems[0]).toContain("subscription, token, one_time");
  });

  it("reports a missing kind too", () => {
    expect(unknownKindProblems([{ key: "kurs", kind: undefined }])).toHaveLength(1);
  });

  it("stays silent for every declared kind", () => {
    const products = PRODUCT_KINDS.map((kind) => ({ key: kind, kind }));
    expect(unknownKindProblems(products)).toEqual([]);
  });

  it("stays silent for an empty registry", () => {
    // An empty registry is the normal state mid-setup; the empty state on
    // /plans is what reports it, not a load failure.
    expect(unknownKindProblems([])).toEqual([]);
  });
});

// A parked offering that HAS a Digistore24 id — the state the whole seam is
// about. Built by hand rather than read from the registry: the shipped one
// never holds a parked entry, which is exactly why a test reading it directly
// would prove nothing (same argument as `plan-sections.ts` and
// `productByDs24Id` make for taking their list as an argument).
const PARKED: ProductDef = {
  key: "retired_plan",
  name: "Retired plan",
  kind: "subscription",
  billingInterval: "1_month",
  priceCents: 1900,
  sell: false,
  productIds: { prod: { de: "9001", en: "9002" } },
};

describe("isSold", () => {
  it("treats a missing sell field as sold", () => {
    // The load-bearing default: every registry in the wild has no such field.
    expect(isSold({})).toBe(true);
  });

  it("treats an explicit undefined as sold", () => {
    expect(isSold({ sell: undefined })).toBe(true);
  });

  it("treats true as sold", () => {
    expect(isSold({ sell: true })).toBe(true);
  });

  it("parks only on a literal false", () => {
    expect(isSold({ sell: false })).toBe(false);
  });
});

describe("sellableProducts", () => {
  it("drops exactly the entries parked with a literal false", () => {
    // Registry-independent on purpose, like everything else in this file
    // (see `someProduct` at the top): this test travels into the customer's
    // app, and parking an entry is the DOCUMENTED move — the sync gate's own
    // option 2 says `"sell": false`. An equality against `allProducts()`
    // here would go red the moment they do what they were told, in an app
    // with no line of their own code. What holds in EVERY registry state:
    // parking is the only way out of the sellable list.
    const sellable = new Set(sellableProducts().map((p) => p.key));
    for (const p of allProducts()) {
      expect(sellable.has(p.key)).toBe(p.sell !== false);
    }
  });

  it("drops a parked offering", () => {
    expect(sellableProducts().some((p) => p.key === PARKED.key)).toBe(false);
  });
});

// 🚨 THE needle of the `sell` field: the money path must not be filtered.
//
// Each of these four answers a question about a purchase that ALREADY
// happened. Move the filter into `allProducts()` — or into
// `syncedProductIds()` one file over — and every one of them starts answering
// "I do not know this product" for somebody who is paying: no entitlement on
// the next rebill, no refund, no chargeback, no `payment_missed`. And
// `orders.productKey` is never reconstructed afterwards.
describe("a parked offering is still ANSWERED for", () => {
  it("productByDs24Id finds it by its Digistore24 id", () => {
    expect(productByDs24Id("9001", [PARKED])?.key).toBe(PARKED.key);
    expect(productByDs24Id("9002", [PARKED])?.key).toBe(PARKED.key);
  });

  it("findProduct and getProduct read the raw registry, not a filtered list", (ctx) => {
    // Against the shipped registry rather than the fixture, because
    // findProduct/getProduct read the raw file and take no list: the claim is
    // that they are unaffected BY CONSTRUCTION, and only the real one shows
    // that. (The parked half of the claim needs a parked entry and lives in
    // sell-seam.test.ts, on the mocked registry.)
    const any = allProducts()[0];
    if (!any) {
      // An empty registry is a legitimate mid-setup state — but "green
      // because it skipped" must not look like "green because it checked".
      return notChecked(ctx, "config/digistore-products.json holds no products at all");
    }
    expect(findProduct(any.key)?.key).toBe(any.key);
    expect(getProduct(any.key).key).toBe(any.key);
  });

  it("is what sellableProducts refuses — the counter-proof", () => {
    // The same object, the same run: one list has it, the other does not.
    // Without this line the four assertions above would also pass if `sell`
    // did nothing at all.
    expect([PARKED].filter(isSold)).toEqual([]);
  });
});

describe("sellFieldProblems", () => {
  it("names a string 'false' — the typo that would put a product on sale", () => {
    const problems = sellFieldProblems([{ key: "pro", sell: "false" }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"pro"');
    expect(problems[0]).toContain('"false"');
  });

  it.each([0, 1, "true", null, {}])("refuses %o", (sell) => {
    expect(sellFieldProblems([{ key: "x", sell }])).toHaveLength(1);
  });

  it("stays silent for true, false and absent", () => {
    expect(
      sellFieldProblems([
        { key: "a", sell: true },
        { key: "b", sell: false },
        { key: "c" },
        { key: "d", sell: undefined },
      ]),
    ).toEqual([]);
  });

  it("stays silent for the shipped registry", () => {
    // The module-load guard throws on a problem here, so this is really an
    // assertion that importing this file at all was legitimate.
    expect(sellFieldProblems(allProducts())).toEqual([]);
  });
});
