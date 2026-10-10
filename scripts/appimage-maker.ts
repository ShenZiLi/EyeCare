import { MakerBase, type MakerOptions } from '@electron-forge/maker-base';
import type { ForgePlatform } from '@electron-forge/shared-types';
import { chmod, copyFile, cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import path from 'node:path';

/** Native Linux packaging follows AppImage's AppDir format; no sandbox flags are relaxed. */
export class MakerAppImage extends MakerBase<Record<string, never>> {
  name = 'eyecare-appimage';
  defaultPlatforms: ForgePlatform[] = ['linux'];
  requiredExternalBinaries = ['appimagetool'];
  isSupportedOnCurrentPlatform(): boolean { return process.platform === 'linux'; }
  async make(options: MakerOptions): Promise<string[]> {
    if (options.targetPlatform !== 'linux' || options.targetArch !== 'x64') throw new Error('AppImage currently targets Linux x64');
    await mkdir(options.makeDir, { recursive: true });
    const work = await mkdtemp(path.join(options.makeDir, '.appimage-'));
    const directory = path.join(work, 'EyeCare.AppDir');
    const payload = path.join(directory, 'usr/lib/eyecare');
    await mkdir(path.dirname(payload), { recursive: true });
    await cp(options.dir, payload, { recursive: true });
    await copyFile(path.resolve('resources/icon.png'), path.join(directory, 'eyecare.png'));
    await writeFile(path.join(directory, 'eyecare.desktop'), '[Desktop Entry]\nType=Application\nName=EyeCare\nComment=Local eye care reminder\nExec=AppRun\nIcon=eyecare\nTerminal=false\nCategories=Utility;\n');
    await writeFile(path.join(directory, 'AppRun'), '#!/bin/sh\nHERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$HERE/usr/lib/eyecare/eyecare" "$@"\n');
    await chmod(path.join(directory, 'AppRun'), 0o755);
    const version: unknown = options.packageJSON.version;
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-.][a-zA-Z0-9.]+)?$/.test(version)) throw new Error('Invalid application version for artifact path');
    const artifact = path.join(options.makeDir, `EyeCare-${version}-x86_64.AppImage`);
    await promisify(execFile)('appimagetool', [directory, artifact], { env: { ...process.env, ARCH: 'x86_64', APPIMAGE_EXTRACT_AND_RUN: '1' }, timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
    return [artifact];
  }
}
