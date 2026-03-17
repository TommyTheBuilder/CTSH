(function attachOpenPalletCountries(globalObject) {
  function normalizeToken(value) {
    return String(value ?? "")
      .trim()
      .toUpperCase()
      .replaceAll("\u00c4", "AE")
      .replaceAll("\u00d6", "OE")
      .replaceAll("\u00dc", "UE")
      .replace(/[^A-Z0-9]/g, "");
  }

  const COUNTRY_DEFINITIONS = [
    { code: "A", name: "\u00d6sterreich", aliases: ["AT", "AUT", "Oesterreich", "Austria"] },
    { code: "AL", name: "Albanien", aliases: ["Albania"] },
    { code: "AND", name: "Andorra", aliases: [] },
    { code: "B", name: "Belgien", aliases: ["Belgium"] },
    { code: "BG", name: "Bulgarien", aliases: ["Bulgaria"] },
    { code: "BIH", name: "Bosnien und Herzegowina", aliases: ["Bosnia and Herzegovina"] },
    { code: "BY", name: "Belarus", aliases: ["Wei\u00dfrussland"] },
    { code: "CH", name: "Schweiz", aliases: ["Switzerland"] },
    { code: "CY", name: "Zypern", aliases: ["Cyprus"] },
    { code: "CZ", name: "Tschechien", aliases: ["Czechia", "Czech Republic"] },
    { code: "D", name: "Deutschland", aliases: ["DE", "DEU", "Germany"] },
    { code: "DK", name: "D\u00e4nemark", aliases: ["Denmark"] },
    { code: "E", name: "Spanien", aliases: ["Espana", "Spain"] },
    { code: "EST", name: "Estland", aliases: ["Estonia"] },
    { code: "F", name: "Frankreich", aliases: ["France"] },
    { code: "FIN", name: "Finnland", aliases: ["Finland"] },
    { code: "FL", name: "Liechtenstein", aliases: [] },
    { code: "GR", name: "Griechenland", aliases: ["Greece", "Hellas"] },
    { code: "H", name: "Ungarn", aliases: ["Hungary", "Magyarorszag"] },
    { code: "HR", name: "Kroatien", aliases: ["Croatia", "Hrvatska"] },
    { code: "I", name: "Italien", aliases: ["Italy", "Italia"] },
    { code: "IRL", name: "Irland", aliases: ["Ireland", "Eire"] },
    { code: "IS", name: "Island", aliases: ["Iceland"] },
    { code: "L", name: "Luxemburg", aliases: ["Luxembourg"] },
    { code: "LT", name: "Litauen", aliases: ["Lithuania"] },
    { code: "LV", name: "Lettland", aliases: ["Latvia"] },
    { code: "M", name: "Malta", aliases: [] },
    { code: "MC", name: "Monaco", aliases: [] },
    { code: "MD", name: "Moldau", aliases: ["Moldova"] },
    { code: "MNE", name: "Montenegro", aliases: [] },
    { code: "N", name: "Norwegen", aliases: ["Norway"] },
    { code: "NL", name: "Niederlande", aliases: ["Netherlands", "Holland"] },
    { code: "NMK", name: "Nordmazedonien", aliases: ["North Macedonia", "MK"] },
    { code: "P", name: "Portugal", aliases: [] },
    { code: "PL", name: "Polen", aliases: ["Poland"] },
    { code: "RO", name: "Rum\u00e4nien", aliases: ["Romania"] },
    { code: "RS", name: "Serbien", aliases: ["Serbia"] },
    { code: "RSM", name: "San Marino", aliases: [] },
    { code: "S", name: "Schweden", aliases: ["Sweden", "Sverige"] },
    { code: "SK", name: "Slowakei", aliases: ["Slovakia"] },
    { code: "SLO", name: "Slowenien", aliases: ["Slovenia"] },
    { code: "TR", name: "T\u00fcrkei", aliases: ["Turkey", "Turkiye"] },
    { code: "UA", name: "Ukraine", aliases: [] },
    { code: "UK", name: "Vereinigtes K\u00f6nigreich", aliases: ["GB", "Grossbritannien", "United Kingdom"] },
    { code: "V", name: "Vatikanstadt", aliases: ["Vatikan", "Vatican City"] }
  ];

  const normalizedToCode = Object.create(null);
  const aliasesByCode = Object.create(null);
  const labelsByCode = Object.create(null);

  const list = COUNTRY_DEFINITIONS.map((entry) => {
    const item = {
      code: entry.code,
      name: entry.name,
      label: `${entry.code} - ${entry.name}`
    };
    const tokens = new Set(
      [entry.code, entry.name, item.label, ...(entry.aliases || [])]
        .map((value) => normalizeToken(value))
        .filter(Boolean)
    );
    aliasesByCode[item.code] = Array.from(tokens);
    labelsByCode[item.code] = item.label;
    tokens.forEach((token) => {
      normalizedToCode[token] = item.code;
    });
    return item;
  });

  function normalize(value) {
    const token = normalizeToken(value);
    return token ? (normalizedToCode[token] || "") : "";
  }

  function isSupported(value) {
    return Boolean(normalize(value));
  }

  const api = {
    list,
    labelsByCode,
    aliasesByCode,
    normalize,
    isSupported
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalObject && typeof globalObject === "object") {
    globalObject.OPEN_PALLET_COUNTRIES = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
