/**
 * dictionaries.js — lookup tables for the verbalizer.
 * Every entry is [singular, plural]; French entries carry their own gender-
 * correct plural so "1 euro" / "2 euros" both come out right.
 */

/* ── Currency ────────────────────────────────────────────────────────── */

export const CURRENCY = {
  $:    { en: ['dollar', 'dollars'],            fr: ['dollar', 'dollars'] },
  'CA$':{ en: ['Canadian dollar', 'Canadian dollars'], fr: ['dollar canadien', 'dollars canadiens'] },
  'C$': { en: ['Canadian dollar', 'Canadian dollars'], fr: ['dollar canadien', 'dollars canadiens'] },
  'US$':{ en: ['US dollar', 'US dollars'],      fr: ['dollar américain', 'dollars américains'] },
  'A$': { en: ['Australian dollar', 'Australian dollars'], fr: ['dollar australien', 'dollars australiens'] },
  'NZ$':{ en: ['New Zealand dollar', 'New Zealand dollars'], fr: ['dollar néo-zélandais', 'dollars néo-zélandais'] },
  'HK$':{ en: ['Hong Kong dollar', 'Hong Kong dollars'], fr: ['dollar de Hong Kong', 'dollars de Hong Kong'] },
  'R$': { en: ['real', 'reais'],                fr: ['réal', 'réaux'] },
  '€':  { en: ['euro', 'euros'],                fr: ['euro', 'euros'] },
  '£':  { en: ['pound', 'pounds'],              fr: ['livre', 'livres'] },
  '¥':  { en: ['yen', 'yen'],                   fr: ['yen', 'yens'] },
  '₹':  { en: ['rupee', 'rupees'],              fr: ['roupie', 'roupies'] },
  '¢':  { en: ['cent', 'cents'],                fr: ['cent', 'cents'] },
  '₩':  { en: ['won', 'won'],                   fr: ['won', 'wons'] },
  '₽':  { en: ['ruble', 'rubles'],              fr: ['rouble', 'roubles'] },
  '₪':  { en: ['shekel', 'shekels'],            fr: ['shekel', 'shekels'] },
  '₺':  { en: ['lira', 'lira'],                 fr: ['livre turque', 'livres turques'] },
  '฿':  { en: ['baht', 'baht'],                 fr: ['baht', 'bahts'] },
  '₫':  { en: ['dong', 'dong'],                 fr: ['dong', 'dongs'] },
  '₦':  { en: ['naira', 'naira'],               fr: ['naira', 'nairas'] },
  '₱':  { en: ['peso', 'pesos'],                fr: ['peso', 'pesos'] },
  '₴':  { en: ['hryvnia', 'hryvnia'],           fr: ['hryvnia', 'hryvnias'] },
  '₡':  { en: ['colón', 'colones'],             fr: ['colón', 'colones'] },
};

/** ISO 4217 codes, matched case-sensitively so "CAD" ≠ "cad". */
export const CURRENCY_CODES = {
  USD: { en: ['US dollar', 'US dollars'],        fr: ['dollar américain', 'dollars américains'] },
  CAD: { en: ['Canadian dollar', 'Canadian dollars'], fr: ['dollar canadien', 'dollars canadiens'] },
  EUR: { en: ['euro', 'euros'],                  fr: ['euro', 'euros'] },
  GBP: { en: ['British pound', 'British pounds'], fr: ['livre sterling', 'livres sterling'] },
  JPY: { en: ['yen', 'yen'],                     fr: ['yen', 'yens'] },
  CNY: { en: ['yuan', 'yuan'],                   fr: ['yuan', 'yuans'] },
  AUD: { en: ['Australian dollar', 'Australian dollars'], fr: ['dollar australien', 'dollars australiens'] },
  NZD: { en: ['New Zealand dollar', 'New Zealand dollars'], fr: ['dollar néo-zélandais', 'dollars néo-zélandais'] },
  CHF: { en: ['Swiss franc', 'Swiss francs'],    fr: ['franc suisse', 'francs suisses'] },
  SEK: { en: ['Swedish krona', 'Swedish kronor'], fr: ['couronne suédoise', 'couronnes suédoises'] },
  NOK: { en: ['Norwegian krone', 'Norwegian kroner'], fr: ['couronne norvégienne', 'couronnes norvégiennes'] },
  DKK: { en: ['Danish krone', 'Danish kroner'],  fr: ['couronne danoise', 'couronnes danoises'] },
  MXN: { en: ['Mexican peso', 'Mexican pesos'],  fr: ['peso mexicain', 'pesos mexicains'] },
  BRL: { en: ['Brazilian real', 'Brazilian reais'], fr: ['réal brésilien', 'réaux brésiliens'] },
  INR: { en: ['Indian rupee', 'Indian rupees'],  fr: ['roupie indienne', 'roupies indiennes'] },
  KRW: { en: ['won', 'won'],                     fr: ['won', 'wons'] },
  ZAR: { en: ['rand', 'rand'],                   fr: ['rand', 'rands'] },
  HKD: { en: ['Hong Kong dollar', 'Hong Kong dollars'], fr: ['dollar de Hong Kong', 'dollars de Hong Kong'] },
  SGD: { en: ['Singapore dollar', 'Singapore dollars'], fr: ['dollar de Singapour', 'dollars de Singapour'] },
  PLN: { en: ['zloty', 'zloty'],                 fr: ['zloty', 'zlotys'] },
  RUB: { en: ['ruble', 'rubles'],                fr: ['rouble', 'roubles'] },
  TRY: { en: ['Turkish lira', 'Turkish lira'],   fr: ['livre turque', 'livres turques'] },
  ILS: { en: ['shekel', 'shekels'],              fr: ['shekel', 'shekels'] },
  AED: { en: ['dirham', 'dirhams'],              fr: ['dirham', 'dirhams'] },
  SAR: { en: ['riyal', 'riyals'],                fr: ['riyal', 'riyals'] },
};

/** Sub-unit name used for the two-decimal part of an amount. */
export const SUBUNIT = {
  default: { en: ['cent', 'cents'], fr: ['cent', 'cents'] },
  '£':      { en: ['penny', 'pence'], fr: ['penny', 'pence'] },
  GBP:      { en: ['penny', 'pence'], fr: ['penny', 'pence'] },
  '€':      { en: ['cent', 'cents'], fr: ['centime', 'centimes'] },
  EUR:      { en: ['cent', 'cents'], fr: ['centime', 'centimes'] },
};

/* ── Magnitude suffixes ──────────────────────────────────────────────── */

/** "mille" never takes a plural -s; the larger scale words do. */
export const FR_INVARIABLE_SCALES = new Set(['mille']);

export const SCALE_SUFFIX = {
  k:  { en: 'thousand', fr: 'mille' },
  K:  { en: 'thousand', fr: 'mille' },
  M:  { en: 'million',  fr: 'million' },
  MM: { en: 'million',  fr: 'million' },
  bn: { en: 'billion',  fr: 'milliard' },
  B:  { en: 'billion',  fr: 'milliard' },
  Md: { en: 'billion',  fr: 'milliard' },
  T:  { en: 'trillion', fr: 'billion' },
  tn: { en: 'trillion', fr: 'billion' },
};

/* ── Units of measure ────────────────────────────────────────────────── */
/* Keyed by the literal suffix as written; case matters for SI prefixes. */

export const UNITS = {
  // mass
  kg:  { en: ['kilogram', 'kilograms'],     fr: ['kilogramme', 'kilogrammes'] },
  g:   { en: ['gram', 'grams'],             fr: ['gramme', 'grammes'] },
  mg:  { en: ['milligram', 'milligrams'],   fr: ['milligramme', 'milligrammes'] },
  µg:  { en: ['microgram', 'micrograms'],   fr: ['microgramme', 'microgrammes'] },
  t:   { en: ['tonne', 'tonnes'],           fr: ['tonne', 'tonnes'] },
  lb:  { en: ['pound', 'pounds'],           fr: ['livre', 'livres'] },
  lbs: { en: ['pound', 'pounds'],           fr: ['livre', 'livres'] },
  oz:  { en: ['ounce', 'ounces'],           fr: ['once', 'onces'] },
  // length
  km:  { en: ['kilometre', 'kilometres'],   fr: ['kilomètre', 'kilomètres'] },
  m:   { en: ['metre', 'metres'],           fr: ['mètre', 'mètres'] },
  cm:  { en: ['centimetre', 'centimetres'], fr: ['centimètre', 'centimètres'] },
  mm:  { en: ['millimetre', 'millimetres'], fr: ['millimètre', 'millimètres'] },
  nm:  { en: ['nanometre', 'nanometres'],   fr: ['nanomètre', 'nanomètres'] },
  mi:  { en: ['mile', 'miles'],             fr: ['mille', 'milles'] },
  ft:  { en: ['foot', 'feet'],              fr: ['pied', 'pieds'] },
  in:  { en: ['inch', 'inches'],            fr: ['pouce', 'pouces'] },
  yd:  { en: ['yard', 'yards'],             fr: ['verge', 'verges'] },
  // area / volume
  ha:  { en: ['hectare', 'hectares'],       fr: ['hectare', 'hectares'] },
  L:   { en: ['litre', 'litres'],           fr: ['litre', 'litres'] },
  ml:  { en: ['millilitre', 'millilitres'], fr: ['millilitre', 'millilitres'] },
  cl:  { en: ['centilitre', 'centilitres'], fr: ['centilitre', 'centilitres'] },
  gal: { en: ['gallon', 'gallons'],         fr: ['gallon', 'gallons'] },
  // time
  ms:  { en: ['millisecond', 'milliseconds'], fr: ['milliseconde', 'millisecondes'] },
  s:   { en: ['second', 'seconds'],         fr: ['seconde', 'secondes'] },
  sec: { en: ['second', 'seconds'],         fr: ['seconde', 'secondes'] },
  min: { en: ['minute', 'minutes'],         fr: ['minute', 'minutes'] },
  h:   { en: ['hour', 'hours'],             fr: ['heure', 'heures'] },
  hr:  { en: ['hour', 'hours'],             fr: ['heure', 'heures'] },
  hrs: { en: ['hour', 'hours'],             fr: ['heure', 'heures'] },
  // data
  b:   { en: ['bit', 'bits'],               fr: ['bit', 'bits'] },
  B:   { en: ['byte', 'bytes'],             fr: ['octet', 'octets'] },
  KB:  { en: ['kilobyte', 'kilobytes'],     fr: ['kilooctet', 'kilooctets'] },
  MB:  { en: ['megabyte', 'megabytes'],     fr: ['mégaoctet', 'mégaoctets'] },
  GB:  { en: ['gigabyte', 'gigabytes'],     fr: ['gigaoctet', 'gigaoctets'] },
  TB:  { en: ['terabyte', 'terabytes'],     fr: ['téraoctet', 'téraoctets'] },
  PB:  { en: ['petabyte', 'petabytes'],     fr: ['pétaoctet', 'pétaoctets'] },
  Kbps:{ en: ['kilobit per second', 'kilobits per second'], fr: ['kilobit par seconde', 'kilobits par seconde'] },
  Mbps:{ en: ['megabit per second', 'megabits per second'], fr: ['mégabit par seconde', 'mégabits par seconde'] },
  Gbps:{ en: ['gigabit per second', 'gigabits per second'], fr: ['gigabit par seconde', 'gigabits par seconde'] },
  // frequency / power / electrical
  Hz:  { en: ['hertz', 'hertz'],            fr: ['hertz', 'hertz'] },
  kHz: { en: ['kilohertz', 'kilohertz'],    fr: ['kilohertz', 'kilohertz'] },
  MHz: { en: ['megahertz', 'megahertz'],    fr: ['mégahertz', 'mégahertz'] },
  GHz: { en: ['gigahertz', 'gigahertz'],    fr: ['gigahertz', 'gigahertz'] },
  W:   { en: ['watt', 'watts'],             fr: ['watt', 'watts'] },
  kW:  { en: ['kilowatt', 'kilowatts'],     fr: ['kilowatt', 'kilowatts'] },
  MW:  { en: ['megawatt', 'megawatts'],     fr: ['mégawatt', 'mégawatts'] },
  kWh: { en: ['kilowatt hour', 'kilowatt hours'], fr: ['kilowattheure', 'kilowattheures'] },
  V:   { en: ['volt', 'volts'],             fr: ['volt', 'volts'] },
  A:   { en: ['amp', 'amps'],               fr: ['ampère', 'ampères'] },
  mAh: { en: ['milliamp hour', 'milliamp hours'], fr: ['milliampère-heure', 'milliampères-heures'] },
  // display / misc
  px:  { en: ['pixel', 'pixels'],           fr: ['pixel', 'pixels'] },
  pt:  { en: ['point', 'points'],           fr: ['point', 'points'] },
  fps: { en: ['frame per second', 'frames per second'], fr: ['image par seconde', 'images par seconde'] },
  'km/h': { en: ['kilometre per hour', 'kilometres per hour'], fr: ['kilomètre-heure', 'kilomètres-heure'] },
  mph: { en: ['mile per hour', 'miles per hour'], fr: ['mille à l’heure', 'milles à l’heure'] },
  '°C': { en: ['degree Celsius', 'degrees Celsius'], fr: ['degré Celsius', 'degrés Celsius'] },
  '°F': { en: ['degree Fahrenheit', 'degrees Fahrenheit'], fr: ['degré Fahrenheit', 'degrés Fahrenheit'] },
  '°':  { en: ['degree', 'degrees'],        fr: ['degré', 'degrés'] },
};

/* ── Standalone symbols ──────────────────────────────────────────────── */

export const SYMBOLS = {
  '&': { en: 'and', fr: 'et' },
  '@': { en: 'at', fr: 'arobase' },
  '%': { en: 'percent', fr: 'pour cent' },
  '‰': { en: 'per mille', fr: 'pour mille' },
  '+': { en: 'plus', fr: 'plus' },
  '=': { en: 'equals', fr: 'égale' },
  '≠': { en: 'is not equal to', fr: 'n’est pas égal à' },
  '≈': { en: 'approximately', fr: 'environ' },
  '<': { en: 'less than', fr: 'inférieur à' },
  '>': { en: 'greater than', fr: 'supérieur à' },
  '≤': { en: 'less than or equal to', fr: 'inférieur ou égal à' },
  '≥': { en: 'greater than or equal to', fr: 'supérieur ou égal à' },
  '±': { en: 'plus or minus', fr: 'plus ou moins' },
  '×': { en: 'times', fr: 'fois' },
  '÷': { en: 'divided by', fr: 'divisé par' },
  '√': { en: 'the square root of', fr: 'racine carrée de' },
  '∞': { en: 'infinity', fr: 'infini' },
  'π': { en: 'pi', fr: 'pi' },
  '©': { en: 'copyright', fr: 'droit d’auteur' },
  '®': { en: 'registered', fr: 'marque déposée' },
  '™': { en: 'trademark', fr: 'marque de commerce' },
  '§': { en: 'section', fr: 'article' },
  '¶': { en: 'paragraph', fr: 'paragraphe' },
  '№': { en: 'number', fr: 'numéro' },
  '#': { en: 'number', fr: 'numéro' },
  '~': { en: 'about', fr: 'environ' },
  '/': { en: 'slash', fr: 'barre oblique' },
  '\\': { en: 'backslash', fr: 'barre oblique inversée' },
  '|': { en: 'pipe', fr: 'barre verticale' },
  '^': { en: 'to the power of', fr: 'puissance' },
  '½': { en: 'one half', fr: 'un demi' },
  '⅓': { en: 'one third', fr: 'un tiers' },
  '¼': { en: 'one quarter', fr: 'un quart' },
  '¾': { en: 'three quarters', fr: 'trois quarts' },
};

/* ── Abbreviations ───────────────────────────────────────────────────── */
/* Conservative on purpose: only forms with no plausible second reading. */

export const ABBREVIATIONS = {
  en: {
    'e.g': 'for example', 'eg': 'for example',
    'i.e': 'that is',
    etc: 'et cetera',
    vs: 'versus', 'v.s': 'versus',
    approx: 'approximately',
    'et al': 'and others',
    ibid: 'ibidem',
    no: 'number', nos: 'numbers',
    fig: 'figure', figs: 'figures',
    vol: 'volume', vols: 'volumes',
    pp: 'pages',
    ca: 'circa',
    'a.m': 'A M', 'am': 'A M',
    'p.m': 'P M', 'pm': 'P M',
  },
  fr: {
    'p.ex': 'par exemple',
    'c.-à-d': 'c’est-à-dire',
    etc: 'et cætera',
    env: 'environ',
    'n°': 'numéro', 'nº': 'numéro',
    vol: 'volume',
    fig: 'figure',
    'cf': 'voir',
  },
};

/* ── Month names, for date rendering ─────────────────────────────────── */

export const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July',
       'August', 'September', 'October', 'November', 'December'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
       'août', 'septembre', 'octobre', 'novembre', 'décembre'],
};

/** Words that mark the following 4-digit number as a year, not a quantity. */
export const YEAR_CUES = new Set([
  'in', 'since', 'by', 'from', 'until', 'till', 'during', 'circa', 'ca', 'around',
  'before', 'after', 'year', 'born', 'died', 'est', 'established', 'founded',
  'published', 'copyright', 'fiscal', 'fy', 'summer', 'winter', 'spring', 'fall',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'en', 'depuis', 'dès', 'vers', 'année', 'années', 'jusqu’en', "jusqu'en",
  'avant', 'après', 'environ', 'né', 'née', 'mort', 'fondé', 'fondée', 'publié',
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
  'septembre', 'octobre', 'novembre', 'décembre',
]);

/** Words that mark the following number as a serial/reference, not a quantity. */
export const SERIAL_CUES = new Set([
  'serial', 'sn', 's/n', 'model', 'part', 'sku', 'ref', 'reference', 'invoice',
  'order', 'account', 'acct', 'id', 'code', 'lot', 'batch', 'tracking', 'isbn',
  'vin', 'imei', 'ticket', 'case', 'file', 'policy', 'badge', 'pin', 'ext',
  'no', 'nº', 'n°', '#',
  'série', 'numéro', 'modèle', 'pièce', 'référence', 'facture', 'commande',
  'compte', 'dossier', 'lot', 'suivi', 'police', 'poste',
]);
