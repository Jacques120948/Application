/**
 * Noms de pays, à partir des codes que Google emploie.
 *
 * Search Console rend des codes ISO à trois lettres — `che`, `ita`, `fra` — quand
 * l'internationalisation de la plateforme ne connaît que ceux à deux lettres. Il manquait
 * donc la seule chose entre « ITA » et « Italie », et « ITA » n'est pas une réponse à
 * montrer à quelqu'un qui cherche d'où viennent ses visiteurs.
 *
 * La table ne fait que le passage à deux lettres : le nom, lui, est demandé au système, qui
 * le rend dans la langue voulue et le tient à jour. Écrire les noms ici aurait figé une
 * géographie qui change, dans une seule langue.
 */

/** ISO 3166-1 alpha-3 vers alpha-2. 249 entrées, une par territoire. */
const ALPHA2: Record<string, string> = {
  abw: 'AW', and: 'AD', are: 'AE', afg: 'AF', atg: 'AG', aia: 'AI',
  alb: 'AL', arm: 'AM', ago: 'AO', ata: 'AQ', arg: 'AR', asm: 'AS',
  aut: 'AT', aus: 'AU', ala: 'AX', aze: 'AZ', bih: 'BA', brb: 'BB',
  bgd: 'BD', bel: 'BE', bfa: 'BF', bgr: 'BG', bhr: 'BH', bdi: 'BI',
  ben: 'BJ', blm: 'BL', bmu: 'BM', brn: 'BN', bol: 'BO', bes: 'BQ',
  bra: 'BR', bhs: 'BS', btn: 'BT', bvt: 'BV', bwa: 'BW', blr: 'BY',
  blz: 'BZ', can: 'CA', cck: 'CC', cod: 'CD', caf: 'CF', cog: 'CG',
  che: 'CH', civ: 'CI', cok: 'CK', chl: 'CL', cmr: 'CM', chn: 'CN',
  col: 'CO', cri: 'CR', cub: 'CU', cpv: 'CV', cuw: 'CW', cxr: 'CX',
  cyp: 'CY', cze: 'CZ', deu: 'DE', dji: 'DJ', dnk: 'DK', dma: 'DM',
  dom: 'DO', dza: 'DZ', ecu: 'EC', est: 'EE', egy: 'EG', esh: 'EH',
  eri: 'ER', esp: 'ES', eth: 'ET', fin: 'FI', fji: 'FJ', flk: 'FK',
  fsm: 'FM', fro: 'FO', fra: 'FR', gab: 'GA', gbr: 'GB', grd: 'GD',
  geo: 'GE', guf: 'GF', ggy: 'GG', gha: 'GH', gib: 'GI', grl: 'GL',
  gmb: 'GM', gin: 'GN', glp: 'GP', gnq: 'GQ', grc: 'GR', sgs: 'GS',
  gtm: 'GT', gum: 'GU', gnb: 'GW', guy: 'GY', hkg: 'HK', hmd: 'HM',
  hnd: 'HN', hrv: 'HR', hti: 'HT', hun: 'HU', idn: 'ID', irl: 'IE',
  isr: 'IL', imn: 'IM', ind: 'IN', iot: 'IO', irq: 'IQ', irn: 'IR',
  isl: 'IS', ita: 'IT', jey: 'JE', jam: 'JM', jor: 'JO', jpn: 'JP',
  ken: 'KE', kgz: 'KG', khm: 'KH', kir: 'KI', com: 'KM', kna: 'KN',
  prk: 'KP', kor: 'KR', kwt: 'KW', cym: 'KY', kaz: 'KZ', lao: 'LA',
  lbn: 'LB', lca: 'LC', lie: 'LI', lka: 'LK', lbr: 'LR', lso: 'LS',
  ltu: 'LT', lux: 'LU', lva: 'LV', lby: 'LY', mar: 'MA', mco: 'MC',
  mda: 'MD', mne: 'ME', maf: 'MF', mdg: 'MG', mhl: 'MH', mkd: 'MK',
  mli: 'ML', mmr: 'MM', mng: 'MN', mac: 'MO', mnp: 'MP', mtq: 'MQ',
  mrt: 'MR', msr: 'MS', mlt: 'MT', mus: 'MU', mdv: 'MV', mwi: 'MW',
  mex: 'MX', mys: 'MY', moz: 'MZ', nam: 'NA', ncl: 'NC', ner: 'NE',
  nfk: 'NF', nga: 'NG', nic: 'NI', nld: 'NL', nor: 'NO', npl: 'NP',
  nru: 'NR', niu: 'NU', nzl: 'NZ', omn: 'OM', pan: 'PA', per: 'PE',
  pyf: 'PF', png: 'PG', phl: 'PH', pak: 'PK', pol: 'PL', spm: 'PM',
  pcn: 'PN', pri: 'PR', pse: 'PS', prt: 'PT', plw: 'PW', pry: 'PY',
  qat: 'QA', reu: 'RE', rou: 'RO', srb: 'RS', rus: 'RU', rwa: 'RW',
  sau: 'SA', slb: 'SB', syc: 'SC', sdn: 'SD', swe: 'SE', sgp: 'SG',
  shn: 'SH', svn: 'SI', sjm: 'SJ', svk: 'SK', sle: 'SL', smr: 'SM',
  sen: 'SN', som: 'SO', sur: 'SR', ssd: 'SS', stp: 'ST', slv: 'SV',
  sxm: 'SX', syr: 'SY', swz: 'SZ', tca: 'TC', tcd: 'TD', atf: 'TF',
  tgo: 'TG', tha: 'TH', tjk: 'TJ', tkl: 'TK', tls: 'TL', tkm: 'TM',
  tun: 'TN', ton: 'TO', tur: 'TR', tto: 'TT', tuv: 'TV', twn: 'TW',
  tza: 'TZ', ukr: 'UA', uga: 'UG', umi: 'UM', usa: 'US', ury: 'UY',
  uzb: 'UZ', vat: 'VA', vct: 'VC', ven: 'VE', vgb: 'VG', vir: 'VI',
  vnm: 'VN', vut: 'VU', wlf: 'WF', wsm: 'WS', yem: 'YE', myt: 'YT',
  zaf: 'ZA', zmb: 'ZM', zwe: 'ZW',
}

/**
 * Le nom d'un pays dans la langue demandée, ou le code tel quel.
 *
 * Google rend `zzz` pour une origine qu'il n'a pas su déterminer, et peut rendre demain un
 * code que cette table ne connaît pas. Dans les deux cas on montre le code en capitales
 * plutôt que rien : un intitulé étrange se remarque et se corrige, une ligne manquante
 * fausse un total sans que personne ne le voie.
 */
export function nomDuPays(code: string, locale: string): string {
  const brut = code.trim().toLowerCase()
  if (brut === 'zzz' || brut === '') return 'Origine inconnue'

  const alpha2 = ALPHA2[brut]
  if (alpha2 === undefined) return brut.toUpperCase()

  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(alpha2) ?? alpha2
  } catch {
    return alpha2
  }
}
