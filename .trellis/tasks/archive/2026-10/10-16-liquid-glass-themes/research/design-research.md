# Verified design guidance

ui-ux-pro-max local style search `liquid glass` returned active style `liquid-glass`: adaptive translucent materials, lensing/refraction cues, restrained color, glass navigation and controls, separate readable content, reduced transparency/motion and 4.5:1 text contrast.

The aggregate design-system search selected the correct material but unrelated marketing/restaurant typography and layout; those portions were rejected. A narrower explicit style search verified the material. React stack search `interactions` returned behavioral testing guidance; platform-native SwiftUI material APIs are not applicable to this React/Tauri renderer. No dependencies are required.

Apple design skill guidance used: translucent chrome + stable content hierarchy, static layered highlights, interruptible transitions, system/CJK typography, reduced motion/transparency/high contrast. No gesture interaction is being added, so no spring or gesture library is necessary.

Verification uses the user Tabbit browser via installed stable CLI and a mocked desktop bridge at the network interception boundary. No fixture is added to production. Native Tauri build is a separate check, not proof of browser/native equivalence.
