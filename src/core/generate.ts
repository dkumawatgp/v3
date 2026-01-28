import { Logger } from '../utils/logger.js';
import { analyze } from './analyze.js';
import { generateTests } from './test-generator.js';
import { join } from 'path';

export async function generate(url: string): Promise<void> {
  Logger.info(`Starting generation for URL: ${url}`);
  
  try {
    // First, ensure we have analysis data
    // Check if analysis files exist, if not, run analyze
    const snapshotPath = join(process.cwd(), 'outputs', 'page-snapshot.json');
    const interactionMapPath = join(process.cwd(), 'outputs', 'interaction-map.json');
    
    const { readFile } = await import('fs/promises');
    let needsAnalysis = false;
    
    try {
      await readFile(snapshotPath);
      await readFile(interactionMapPath);
      Logger.info('Using existing analysis data');
    } catch {
      Logger.info('Analysis data not found, running analysis first...');
      needsAnalysis = true;
    }
    
    // Run analysis if needed
    if (needsAnalysis) {
      await analyze(url);
    }
    
    // Generate tests from interaction map
    await generateTests(snapshotPath, interactionMapPath);
    
    Logger.success('Generation completed successfully');
    
  } catch (error) {
    Logger.error('Generation failed:', error);
    throw error;
  }
}
