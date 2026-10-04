import { z } from 'zod';

const NAME_MESSAGE = 'Use 2–100 characters';
const SUBDOMAIN_MESSAGE =
  'Use 3–20 lowercase letters, digits or hyphens, starting with a letter';
const DOMAIN_MESSAGE = 'Enter a valid domain, for example yogaspace.com';
const EMAIL_MESSAGE = 'Enter a valid e-mail address';
const PLATFORM_DOMAIN = 'studio-desk.axondigital.xyz';

function blankToUndefined(value: unknown) {
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

function emptyToNull(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return value;
}

/** Trim, then lowercase. Format checks run on the result. */
export function loweredText() {
  return z.string().trim().toLowerCase();
}

export const emailField = z.preprocess(
  blankToUndefined,
  loweredText().pipe(z.email({ error: EMAIL_MESSAGE })),
);

export const studioNameField = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .regex(/^[\s\S]{2,100}$/, { error: NAME_MESSAGE }),
);

export const subdomainField = z.preprocess(
  blankToUndefined,
  loweredText().regex(/^[a-z][a-z0-9-]{1,18}[a-z0-9]$/, {
    error: SUBDOMAIN_MESSAGE,
  }),
);

export function isCustomDomain(value: string): boolean {
  if (value.length > 253 || value.includes('://')) return false;
  if (value === PLATFORM_DOMAIN || value.endsWith(`.${PLATFORM_DOMAIN}`)) {
    return false;
  }
  const labels = value.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
  );
}

export const customDomainField = z.preprocess(
  emptyToNull,
  z.union([
    z.null(),
    loweredText().refine(isCustomDomain, { error: DOMAIN_MESSAGE }),
  ]),
);
