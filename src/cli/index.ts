#!/usr/bin/env node

import { Command } from 'commander';
import { analyze } from '../core/analyze.js';
import { generate } from '../core/generate.js';
import { Logger } from '../utils/logger.js';

const program = new Command();

program
  .name('ai-mfe-test')
  .description('A CLI tool for analyzing and generating')
  .version('1.0.0');

program
  .command('analyze')
  .description('Analyze a URL')
  .argument('<url>', 'URL to analyze')
  .action(async (url: string) => {
    try {
      await analyze(url);
    } catch (error) {
      Logger.error('Analysis failed:', error);
      process.exit(1);
    }
  });

program
  .command('generate')
  .description('Generate from a URL')
  .argument('<url>', 'URL to generate from')
  .action(async (url: string) => {
    try {
      await generate(url);
    } catch (error) {
      Logger.error('Generation failed:', error);
      process.exit(1);
    }
  });

program.parse();
