/** A configured SharePoint Embedded container type that the user can search. */
export interface EmbeddedSource {
  name: string;
  containerTypeId: string;
  enabled: boolean;
}

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidContainerTypeId(value: string): boolean {
  return GUID_PATTERN.test(value);
}

/** Parse enabled sources and fail before a search if the configuration is ambiguous or invalid. */
export function getEnabledEmbeddedSources(value: unknown): EmbeddedSource[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('SharePoint Embedded sources must be configured as a list.');
  }

  const sources: EmbeddedSource[] = [];
  const names = new Set<string>();
  const containerTypeIds = new Set<string>();

  value.forEach((entry: unknown, index: number) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`SharePoint Embedded source ${index + 1} must be an object.`);
    }

    const candidate = entry as Partial<EmbeddedSource>;
    if (candidate.enabled === false) {
      return;
    }
    if (candidate.enabled !== true) {
      throw new Error(`SharePoint Embedded source ${index + 1} must set enabled to true or false.`);
    }
    if (typeof candidate.name !== 'string' || typeof candidate.containerTypeId !== 'string') {
      throw new Error(`SharePoint Embedded source ${index + 1} must include a name and container type ID.`);
    }

    const name = candidate.name.trim();
    const containerTypeId = candidate.containerTypeId.trim();
    if (!name) {
      throw new Error(`SharePoint Embedded source ${index + 1} must have a non-empty name.`);
    }
    if (!isValidContainerTypeId(containerTypeId)) {
      throw new Error(`SharePoint Embedded source "${name}" must use a valid container type GUID.`);
    }

    const normalizedName = name.toLowerCase();
    const normalizedId = containerTypeId.toLowerCase();
    if (names.has(normalizedName)) {
      throw new Error(`SharePoint Embedded source name "${name}" is duplicated. Give each source a unique name.`);
    }
    if (containerTypeIds.has(normalizedId)) {
      throw new Error(`SharePoint Embedded container type ID for "${name}" is duplicated. Configure each container type once.`);
    }

    names.add(normalizedName);
    containerTypeIds.add(normalizedId);
    sources.push({ name, containerTypeId, enabled: true });
  });

  return sources;
}

/** Validate an arbitrary config value and return its usable enabled sources. */
export const validateEmbeddedSources = getEnabledEmbeddedSources;
