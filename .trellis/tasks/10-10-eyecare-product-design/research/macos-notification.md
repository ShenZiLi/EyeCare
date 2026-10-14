# macOS notification repair —2026-10-14

## Gap and boundary

User reports notification reminder failing with UNErrorDomain1. Installed Electron44.7.0 uses UNNotification APIs and requests authorization internally; native delivery failure remains authoritative. Current packaged binary has only a linker ad-hoc signature (Identifier Electron, Info.plist unbound, no resources seal); no code-signing identity is available. Fix local macOS packaging to sign the entire app bundle ad-hoc when no developer identity is configured, retain existing developer signing/notarization when present, and report macOS authorization denial with actionable settings instructions instead of raw localized NSError. No silent fallback, settings mutation, permission resets or certificate creation. Source target forge.config.ts/new bounded signing helper, coordinator error mapping and focused tests. No full test suite per user preference.

## Primary references

https://www.electronjs.org/docs/latest/api/notification requires code signing; isSupported is API availability rather than authorization.
https://raw.githubusercontent.com/electron/electron/v44.7.0/shell/browser/notifications/mac/notification_presenter_mac.mm requests authorization in presenter initialization.
https://raw.githubusercontent.com/electron/electron/v44.7.0/shell/browser/notifications/mac/cocoa_notification.mm forwards NSError localizedDescription on failure.

Local ad-hoc signing is not Developer ID distribution/notarization, and does not override user notification permissions. Actual delivery must be tested separately before claiming fixed.

Actual System Settings Notifications list on this host contains no EyeCare entry before repair. Read-only inspection;no OS notification permission was changed. Local Forge uses installed osxSign with ad-hoc identity,automatic entitlements/provisioning disabled,and no Developer ID timestamp;the signed app must still request user authorization.

## Result

Focused reminder lifecycle regression29/29,typecheck and scopedlint passed;checkagent source review approved. First rebuilt .app verified codesign --verify --deep --strict,Identifierorg.eyecare.desktop,Info.plist entries31,SealedResourcesversion2 files11. Root launched real app,selected notification and previewed through native UI: preview ended automatically without failure (Electron show acknowledges successful UNNotificationCenter submission). No OS notification settings changed by agent. This proves submission,not guaranteed visible banner or physical delivery under Focus/screen sharing. Final make repeats only because exact captured Chinese punctuation error mapping was fixed after first bundle build. Final app is reopened. User preference retained as selected notification;all other settings untouched. Local signing is not distribution signing/notarization.
