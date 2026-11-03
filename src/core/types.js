// Every kind of item PasteGuard can hide. `prefix` is what appears in the
// placeholder ([EMAIL_1]); `priority` decides which span wins when two
// detectors claim overlapping text (higher wins).

export const GROUPS = {
  secrets: 'Secrets and keys',
  contact: 'Contact details',
  identity: 'People and IDs',
  financial: 'Financial',
  network: 'Network',
  custom: 'Your terms',
};

export const TYPES = {
  CUSTOM:       { prefix: 'TERM',        label: 'Custom term',      group: 'custom',    priority: 100, enabled: true },
  PRIVATE_KEY:  { prefix: 'PRIVATE_KEY', label: 'Private key',      group: 'secrets',   priority: 95,  enabled: true },
  API_KEY:      { prefix: 'API_KEY',     label: 'API key',          group: 'secrets',   priority: 90,  enabled: true },
  JWT:          { prefix: 'JWT',         label: 'JSON web token',   group: 'secrets',   priority: 90,  enabled: true },
  TOKEN:        { prefix: 'TOKEN',       label: 'Access token',     group: 'secrets',   priority: 85,  enabled: true },
  PASSWORD:     { prefix: 'PASSWORD',    label: 'Password',         group: 'secrets',   priority: 85,  enabled: true },
  SECRET:       { prefix: 'SECRET',      label: 'Secret value',     group: 'secrets',   priority: 80,  enabled: true },
  CARD:         { prefix: 'CARD',        label: 'Card number',      group: 'financial', priority: 75,  enabled: true },
  IBAN:         { prefix: 'IBAN',        label: 'IBAN',             group: 'financial', priority: 75,  enabled: true },
  BANK_ACCOUNT: { prefix: 'BANK_ACCOUNT',label: 'Bank account',     group: 'financial', priority: 40,  enabled: true },
  SSN:          { prefix: 'SSN',         label: 'US SSN',           group: 'identity',  priority: 75,  enabled: true },
  AADHAAR:      { prefix: 'AADHAAR',     label: 'Aadhaar number',   group: 'identity',  priority: 75,  enabled: true },
  PAN:          { prefix: 'PAN',         label: 'PAN (India)',      group: 'identity',  priority: 75,  enabled: true },
  ID_NUMBER:    { prefix: 'ID_NUMBER',   label: 'ID document',      group: 'identity',  priority: 40,  enabled: true },
  EMAIL:        { prefix: 'EMAIL',       label: 'Email address',    group: 'contact',   priority: 70,  enabled: true },
  PHONE:        { prefix: 'PHONE',       label: 'Phone number',     group: 'contact',   priority: 60,  enabled: true },
  IP:           { prefix: 'IP',          label: 'IP address',       group: 'network',   priority: 55,  enabled: true },
  MAC:          { prefix: 'MAC',         label: 'MAC address',      group: 'network',   priority: 55,  enabled: true },
  PERSON:       { prefix: 'PERSON',      label: 'Person name',      group: 'identity',  priority: 30,  enabled: true },
  LOCATION:     { prefix: 'LOCATION',    label: 'Place or address', group: 'identity',  priority: 30,  enabled: true },
  ORG:          { prefix: 'ORG',         label: 'Organisation',     group: 'identity',  priority: 30,  enabled: false },
};

export function typeInfo(type) {
  return TYPES[type] || { prefix: type, label: type, group: 'custom', priority: 0, enabled: true };
}

// Human summary: { EMAIL: 2, API_KEY: 1 } -> "2 email addresses, 1 API key"
export function summarize(counts) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => {
      let label = typeInfo(type).label;
      // Keep acronyms (API key, IBAN, US SSN); lower-case ordinary words.
      if (/^[A-Z][a-z]/.test(label)) label = label[0].toLowerCase() + label.slice(1);
      return `${n} ${n === 1 ? label : pluralize(label)}`;
    })
    .join(', ');
}

function pluralize(label) {
  if (/ \(/.test(label)) return label.replace(/ \(/, 's (');
  if (/(ss|sh|ch|x)$/.test(label)) return label + 'es';
  if (/s$/.test(label)) return label;
  return label + 's';
}
