/**
 * Countries customers can choose at checkout (a copy lives in the storefront: lib/countries.ts).
 * `aliases` lets the excluded-destinations list use other names ("Ivory Coast", "Western Samoa").
 */
export interface Country {
  name: string;
  aliases?: string[];
}

export const UK = 'United Kingdom';

export const COUNTRIES: Country[] = [
  { name: 'United Kingdom', aliases: ['UK', 'Great Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland'] },
  { name: 'Afghanistan' }, { name: 'Albania' }, { name: 'Algeria' }, { name: 'Andorra' }, { name: 'Angola' },
  { name: 'Antigua and Barbuda' }, { name: 'Argentina' }, { name: 'Armenia' }, { name: 'Australia' }, { name: 'Austria' },
  { name: 'Azerbaijan' }, { name: 'Bahamas' }, { name: 'Bahrain' }, { name: 'Bangladesh' }, { name: 'Barbados' },
  { name: 'Belarus' }, { name: 'Belgium' }, { name: 'Belize' }, { name: 'Benin' }, { name: 'Bhutan' }, { name: 'Bolivia' },
  { name: 'Bosnia and Herzegovina' }, { name: 'Botswana' }, { name: 'Brazil' }, { name: 'Brunei' }, { name: 'Bulgaria' },
  { name: 'Burkina Faso' }, { name: 'Burundi' }, { name: 'Cambodia' }, { name: 'Cameroon' }, { name: 'Canada' },
  { name: 'Cape Verde' }, { name: 'Central African Republic' }, { name: 'Chad' }, { name: 'Chile' }, { name: 'China' },
  { name: 'Colombia' }, { name: 'Comoros' }, { name: 'Congo' }, { name: 'Costa Rica' },
  { name: "Côte d'Ivoire", aliases: ['Ivory Coast', 'Cote dIvoire'] }, { name: 'Croatia' }, { name: 'Cuba' },
  { name: 'Cyprus' }, { name: 'Czech Republic', aliases: ['Czechia'] }, { name: 'Democratic Republic of the Congo' },
  { name: 'Denmark' }, { name: 'Djibouti' }, { name: 'Dominica' }, { name: 'Dominican Republic' }, { name: 'Ecuador' },
  { name: 'Egypt' }, { name: 'El Salvador' }, { name: 'Equatorial Guinea' }, { name: 'Eritrea' }, { name: 'Estonia' },
  { name: 'Eswatini', aliases: ['Swaziland'] }, { name: 'Ethiopia' }, { name: 'Fiji' }, { name: 'Finland' }, { name: 'France' },
  { name: 'French Polynesia' }, { name: 'Gabon' }, { name: 'Gambia' }, { name: 'Georgia' }, { name: 'Germany' },
  { name: 'Ghana' }, { name: 'Gibraltar' }, { name: 'Greece' }, { name: 'Grenada' }, { name: 'Guatemala' }, { name: 'Guinea' },
  { name: 'Guinea-Bissau' }, { name: 'Guyana' }, { name: 'Haiti' }, { name: 'Honduras' }, { name: 'Hong Kong' },
  { name: 'Hungary' }, { name: 'Iceland' }, { name: 'India' }, { name: 'Indonesia' }, { name: 'Iran' }, { name: 'Iraq' },
  { name: 'Ireland', aliases: ['Republic of Ireland', 'Eire'] }, { name: 'Israel' }, { name: 'Italy' }, { name: 'Jamaica' },
  { name: 'Japan' }, { name: 'Jordan' }, { name: 'Kazakhstan' }, { name: 'Kenya' }, { name: 'Kiribati' }, { name: 'Kosovo' },
  { name: 'Kuwait' }, { name: 'Kyrgyzstan' }, { name: 'Laos' }, { name: 'Latvia' }, { name: 'Lebanon' }, { name: 'Lesotho' },
  { name: 'Liberia' }, { name: 'Libya' }, { name: 'Liechtenstein' }, { name: 'Lithuania' }, { name: 'Luxembourg' },
  { name: 'Macau' }, { name: 'Madagascar' }, { name: 'Malawi' }, { name: 'Malaysia' }, { name: 'Maldives' }, { name: 'Mali' },
  { name: 'Malta' }, { name: 'Marshall Islands' }, { name: 'Mauritania' }, { name: 'Mauritius' }, { name: 'Mexico' },
  { name: 'Micronesia' }, { name: 'Moldova' }, { name: 'Monaco' }, { name: 'Mongolia' }, { name: 'Montenegro' },
  { name: 'Morocco' }, { name: 'Mozambique' }, { name: 'Myanmar', aliases: ['Burma'] }, { name: 'Namibia' }, { name: 'Nauru' },
  { name: 'Nepal' }, { name: 'Netherlands', aliases: ['Holland'] }, { name: 'New Zealand' }, { name: 'Nicaragua' },
  { name: 'Niger' }, { name: 'Nigeria' }, { name: 'Niue' }, { name: 'North Korea' }, { name: 'North Macedonia' },
  { name: 'Norway' }, { name: 'Oman' }, { name: 'Pakistan' }, { name: 'Palau' }, { name: 'Palestine' }, { name: 'Panama' },
  { name: 'Papua New Guinea' }, { name: 'Paraguay' }, { name: 'Peru' }, { name: 'Philippines' }, { name: 'Poland' },
  { name: 'Portugal' }, { name: 'Puerto Rico' }, { name: 'Qatar' }, { name: 'Romania' }, { name: 'Russia', aliases: ['Russian Federation'] },
  { name: 'Rwanda' }, { name: 'Saint Kitts and Nevis' }, { name: 'Saint Lucia' }, { name: 'Saint Vincent and the Grenadines' },
  { name: 'Samoa', aliases: ['Western Samoa'] }, { name: 'San Marino' },
  { name: 'São Tomé and Príncipe', aliases: ['Sao Tome and Principe', 'São Tomé & Príncipe'] }, { name: 'Saudi Arabia' },
  { name: 'Senegal' }, { name: 'Serbia' }, { name: 'Seychelles' }, { name: 'Sierra Leone' }, { name: 'Singapore' },
  { name: 'Slovakia' }, { name: 'Slovenia' }, { name: 'Solomon Islands' }, { name: 'Somalia' }, { name: 'South Africa' },
  { name: 'South Korea', aliases: ['Korea'] }, { name: 'South Sudan' }, { name: 'Spain' }, { name: 'Sri Lanka' },
  { name: 'Sudan' }, { name: 'Suriname' }, { name: 'Sweden' }, { name: 'Switzerland' }, { name: 'Syria' }, { name: 'Taiwan' },
  { name: 'Tajikistan' }, { name: 'Tanzania' }, { name: 'Thailand' }, { name: 'Timor-Leste' }, { name: 'Togo' },
  { name: 'Tonga' }, { name: 'Trinidad and Tobago' }, { name: 'Tunisia' }, { name: 'Turkey', aliases: ['Türkiye'] },
  { name: 'Turkmenistan' }, { name: 'Tuvalu' }, { name: 'Uganda' }, { name: 'Ukraine' }, { name: 'United Arab Emirates', aliases: ['UAE'] },
  { name: 'United States', aliases: ['USA', 'United States of America', 'US'] }, { name: 'Uruguay' }, { name: 'Uzbekistan' },
  { name: 'Vanuatu' }, { name: 'Vatican City' }, { name: 'Venezuela' }, { name: 'Vietnam' }, { name: 'Yemen' },
  { name: 'Zambia' }, { name: 'Zimbabwe' },
];

/** Default "Zone 1 – Europe" countries (France, Germany, Spain, Italy, Netherlands, Belgium, Ireland and other European countries). */
export const EUROPE = [
  'France', 'Germany', 'Spain', 'Italy', 'Netherlands', 'Belgium', 'Ireland', 'Portugal', 'Luxembourg', 'Austria',
  'Switzerland', 'Denmark', 'Sweden', 'Norway', 'Finland', 'Iceland', 'Poland', 'Czech Republic', 'Slovakia', 'Hungary',
  'Slovenia', 'Croatia', 'Greece', 'Cyprus', 'Malta', 'Estonia', 'Latvia', 'Lithuania', 'Romania', 'Bulgaria', 'Monaco',
  'Liechtenstein', 'Andorra', 'San Marino', 'Gibraltar', 'Albania', 'Bosnia and Herzegovina', 'Serbia', 'Montenegro',
  'North Macedonia', 'Kosovo', 'Moldova', 'Ukraine', 'Vatican City',
];

/** "Côte d'Ivoire" → "cote divoire" — lower case, no accents or punctuation, "&" = "and". */
export function normalisePlace(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findCountry(name: string): Country | undefined {
  const n = normalisePlace(name);
  return COUNTRIES.find((c) => normalisePlace(c.name) === n || (c.aliases ?? []).some((a) => normalisePlace(a) === n));
}
