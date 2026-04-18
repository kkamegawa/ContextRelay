// Side-effect entry: installs the punycode deprecation filter immediately.
// Import this as the very first import in `extension.ts` so the patch is
// active before any other module is evaluated.
import { installPunycodeDeprecationFilter } from './suppressPunycodeDeprecation';

installPunycodeDeprecationFilter();
