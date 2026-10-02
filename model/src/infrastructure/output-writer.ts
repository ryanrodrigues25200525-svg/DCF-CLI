import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function isExcelArchive(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function outputExistsError(path: string): Error {
  return new Error(`Output already exists: ${path}. Use --force to replace it.`);
}

export function assertOutputDoesNotExist(path: string, force: boolean): void {
  if (existsSync(path) && !force) throw outputExistsError(path);
}

export async function writeWorkbook(path: string, bytes: Uint8Array, force: boolean): Promise<void> {
  if (!isExcelArchive(bytes)) throw new Error('The backend returned an invalid Excel workbook.');
  await mkdir(dirname(path), {recursive: true});
  try {
    await writeFile(path, bytes, {flag: force ? 'w' : 'wx'});
  } catch (error) {
    if (!force && typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
      throw outputExistsError(path);
    }
    throw error;
  }
}
