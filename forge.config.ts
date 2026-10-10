import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { MakerAppImage } from './scripts/appimage-maker';

const config: ForgeConfig = {
  packagerConfig: { ignore: file => Boolean(file) && !['/.vite', '/node_modules', '/resources'].some(prefix => file.startsWith(prefix)), asar: true, executableName: 'eyecare', appBundleId: 'org.eyecare.desktop', appCategoryType: 'public.app-category.healthcare-fitness', icon: 'resources/icon', ...(process.platform === 'darwin' && process.env.EYECARE_SIGN_IDENTITY ? { osxSign: { identity: process.env.EYECARE_SIGN_IDENTITY }, ...(process.env.EYECARE_APPLE_ID && process.env.EYECARE_APPLE_PASSWORD && process.env.EYECARE_APPLE_TEAM ? { osxNotarize: { appleId: process.env.EYECARE_APPLE_ID, appleIdPassword: process.env.EYECARE_APPLE_PASSWORD, teamId: process.env.EYECARE_APPLE_TEAM } } : {}) } : {}) },
  rebuildConfig: {},
  makers: [new MakerSquirrel({ name: 'EyeCare', setupIcon: 'resources/icon.ico', ...(process.env.EYECARE_WINDOWS_CERT_FILE ? { certificateFile: process.env.EYECARE_WINDOWS_CERT_FILE, certificatePassword: process.env.EYECARE_WINDOWS_CERT_PASSWORD } : {}) }), new MakerZIP({}, ['darwin', 'win32', 'linux']), new MakerDeb({ options: { icon: 'resources/icon.png', categories: ['Utility'], maintainer: 'EyeCare contributors', depends: ['libgtk-3-0', 'libnss3', 'libxss1', 'libasound2t64'] } }), new MakerRpm({ options: { icon: 'resources/icon.png', categories: ['Utility'] } }), new MakerAppImage({})],
  plugins: [new AutoUnpackNativesPlugin({}), new VitePlugin({ build: [{ entry: 'app/main/index.ts', config: 'vite.main.config.ts', target: 'main' }, { entry: 'app/preload/index.ts', config: 'vite.preload.config.ts', target: 'preload' }], renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }] })],
};
export default config;
