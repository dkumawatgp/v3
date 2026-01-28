import { chromium, Browser, Page } from 'playwright';
import { Logger } from '../utils/logger.js';
import { saveJsonFile } from '../utils/file-system.js';
import { analyzeMfe } from './mfe-detector.js';
import { join } from 'path';

interface PageSnapshot {
  title: string;
  url: string;
  dom: string;
  scriptUrls: string[];
}

export async function analyze(url: string): Promise<void> {
  Logger.info(`Starting analysis for URL: ${url}`);
  
  let browser: Browser | null = null;
  
  try {
    // Launch Chromium browser
    Logger.info('Launching Chromium browser...');
    browser = await chromium.launch({
      headless: true,
    });
    
    const context = await browser.newContext();
    const page: Page = await context.newPage();
    
    // Track all script URLs loaded via network requests
    const scriptUrls = new Set<string>();
    
    // Listen for network requests to capture dynamically loaded scripts
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      if (resourceType === 'script') {
        scriptUrls.add(request.url());
      }
    });
    
    // Navigate to URL
    Logger.info(`Navigating to: ${url}`);
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    
    // Also capture script tags from DOM (for scripts that might not have loaded yet)
    Logger.info('Capturing script URLs from DOM...');
    const domScriptUrls = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      return scripts.map((script) => (script as HTMLScriptElement).src);
    });
    
    // Merge DOM script URLs with network-loaded scripts
    domScriptUrls.forEach((url) => scriptUrls.add(url));
    
    // Capture page title
    Logger.info('Capturing page title...');
    const title = await page.title();
    
    // Capture current URL (may differ from initial URL due to redirects)
    const currentUrl = page.url();
    
    // Capture serialized DOM (innerHTML of body)
    Logger.info('Capturing DOM...');
    const dom = await page.evaluate(() => {
      return document.body.innerHTML;
    });
    
    // Create snapshot object
    const snapshot: PageSnapshot = {
      title,
      url: currentUrl,
      dom,
      scriptUrls: Array.from(scriptUrls),
    };
    
    // Save to JSON file
    const outputPath = join(process.cwd(), 'outputs', 'page-snapshot.json');
    Logger.info(`Saving snapshot to: ${outputPath}`);
    await saveJsonFile(outputPath, snapshot);
    
    // Perform MFE detection
    Logger.info('Starting MFE detection...');
    await analyzeMfe(outputPath);
    
    Logger.success('Analysis completed successfully');
    
  } catch (error) {
    Logger.error('Analysis failed:', error);
    throw error;
  } finally {
    // Ensure browser is closed even on failure
    if (browser) {
      Logger.info('Closing browser...');
      await browser.close();
    }
  }
}
