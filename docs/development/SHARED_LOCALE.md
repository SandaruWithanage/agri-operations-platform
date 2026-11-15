# Shared English/Sinhala preference

The [accepted data/state/cache ADR](../architecture/decisions/ADR-data-state-cache.md) assigns shared non-sensitive UI preferences to Zustand. The admin farmer/land workspace and both field entry/offline workspaces now use one implementation from `@agri/i18n/react`, backed by pinned Zustand 5.1.0. There is no database migration or new environment variable.

## Ownership and lifetime

`LocaleProvider` creates a vanilla store per mounted workspace, with only `language` and its typed setter. There is no module-global store shared between server requests or authenticated users. The admin default is English; field defaults are Sinhala. Nested views receive the same selected locale, while existing component-local forms/cursors stay local. Each workspace entry supplies its provider so server rendering and isolated mounting both have a defined default.

Server rendering uses that default without browser I/O. After hydration, the provider reads the existing raw-string `agri-language` preference, accepting only `en`/`si`. This preserves current installations without a new persistence format. Only an explicit selected language is persisted; mounting does not rewrite storage. Selecting the current language also records that explicit preference. The provider never serializes a whole store.

The provider updates the document language and receives same-origin localStorage changes from other tabs without echo writes. Removing/clearing the preference restores the workspace default. Malformed values, unrelated keys and sessionStorage events are ignored. When storage is blocked or full, switching still works in memory. Listeners/subscriptions are removed on unmount and handle React strict lifecycle replay.

## Data boundary

Credentials, session/JWT/refresh secrets, farmers, GPS coordinates, permissions, query results and durable mutations never enter this store. Entered names and configured labels are not translated. Changing locale does not remount forms, clear protected records or change query identity when the server output is locale-independent. TanStack Query still owns online records; Dexie owns encrypted offline drafts/reconciliation. The field's existing approved-device/minimal-data/recovery controls are unchanged.

Pages do not share language state across different origins automatically. Admin and field deployments on different origins retain separate optional preferences, consistent with browser storage isolation. Each origin can coordinate its own tabs and routes.

## Validation and limits

Tests cover shared consumers, preserving entered values, legacy preference hydration, explicit same-language selection, malformed/cleared/other-tab preferences, blocked storage, independent store/server defaults and strict cleanup. Admin tests ensure language changes do not refetch farmer records. The compiled browser journeys cover bilingual admin/field/offline operations and actual cross-tab updates. Real-device, native-speaker and accessibility acceptance remain outstanding; these checks do not establish those results.
