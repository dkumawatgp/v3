import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { Logger } from './logger.js';

export async function ensureDirectoryExists(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    Logger.error(`Failed to create directory: ${dir}`, error);
    throw error;
  }
}

export async function saveJsonFile(filePath: string, data: unknown): Promise<void> {
  try {
    await ensureDirectoryExists(filePath);
    const jsonContent = JSON.stringify(data, null, 2);
    await writeFile(filePath, jsonContent, 'utf-8');
    Logger.success(`Saved output to: ${filePath}`);
  } catch (error) {
    Logger.error(`Failed to save file: ${filePath}`, error);
    throw error;
  }
}
