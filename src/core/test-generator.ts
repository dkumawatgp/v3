import { Logger } from '../utils/logger.js';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';

interface PageSnapshot {
  title: string;
  url: string;
  dom: string;
  scriptUrls: string[];
}

interface InteractiveElement {
  role: string;
  accessibleName: string;
  selector: string;
  tagName: string;
  mfeOwner?: string;
}

interface InteractionMap {
  shell: InteractiveElement[];
  mfes: Record<string, InteractiveElement[]>;
}

/**
 * Convert role string to Playwright role type
 */
function getPlaywrightRole(role: string): string {
  const roleMap: Record<string, string> = {
    'button': 'button',
    'link': 'link',
    'textbox': 'textbox',
    'combobox': 'combobox',
    'checkbox': 'checkbox',
    'radio': 'radio',
  };
  
  return roleMap[role] || 'button';
}

/**
 * Sanitize name for use in test names and variables
 */
function sanitizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

/**
 * Generate page load test
 */
function generatePageLoadTest(pageUrl: string, pageTitle: string): string {
  return `import { test, expect } from '@playwright/test';

test('page loads successfully', async ({ page }) => {
  // Navigate to the page
  await page.goto('${pageUrl}');
  
  // Wait for page to be fully loaded
  await page.waitForLoadState('networkidle');
  
  // Assert page title
  await expect(page).toHaveTitle('${pageTitle}');
  
  // Assert page is visible
  await expect(page.locator('body')).toBeVisible();
});
`;
}

/**
 * Generate button click test
 */
function generateButtonClickTest(
  pageUrl: string,
  buttons: InteractiveElement[]
): string {
  if (buttons.length === 0) {
    return '';
  }
  
  const testCases = buttons
    .filter(btn => btn.role === 'button')
    .map((button, index) => {
      const varName = sanitizeName(button.accessibleName) || `button${index}`;
      const role = getPlaywrightRole(button.role);
      
      return `  test('click ${button.accessibleName} button', async ({ page }) => {
    await page.goto('${pageUrl}');
    await page.waitForLoadState('networkidle');
    
    // Find button by role and accessible name
    const ${varName} = page.getByRole('${role}', { name: '${button.accessibleName}' });
    
    // Assert button is visible and enabled
    await expect(${varName}).toBeVisible();
    await expect(${varName}).toBeEnabled();
    
    // Click the button
    await ${varName}.click();
    
    // Assert button is still accessible after click
    await expect(${varName}).toBeVisible();
  });`;
    })
    .join('\n\n');
  
  if (!testCases) {
    return '';
  }
  
  return `import { test, expect } from '@playwright/test';

${testCases}
`;
}

/**
 * Generate all tests from interaction map
 */
export async function generateTests(
  snapshotPath?: string,
  interactionMapPath?: string
): Promise<void> {
  try {
    // Read page snapshot
    const snapshotFilePath = snapshotPath || join(process.cwd(), 'outputs', 'page-snapshot.json');
    Logger.info(`Reading page snapshot from: ${snapshotFilePath}`);
    
    const snapshotContent = await readFile(snapshotFilePath, 'utf-8');
    const snapshot: PageSnapshot = JSON.parse(snapshotContent);
    
    // Read interaction map
    const interactionMapFilePath = interactionMapPath || join(process.cwd(), 'outputs', 'interaction-map.json');
    Logger.info(`Reading interaction map from: ${interactionMapFilePath}`);
    
    const interactionMapContent = await readFile(interactionMapFilePath, 'utf-8');
    const interactionMap: InteractionMap = JSON.parse(interactionMapContent);
    
    // Create generated-tests directory
    const testsDir = join(process.cwd(), 'generated-tests');
    await mkdir(testsDir, { recursive: true });
    
    Logger.info(`Generating tests in: ${testsDir}`);
    
    // Generate page load test
    const pageLoadTest = generatePageLoadTest(snapshot.url, snapshot.title);
    const pageLoadTestPath = join(testsDir, 'page-load.spec.ts');
    await writeFile(pageLoadTestPath, pageLoadTest, 'utf-8');
    Logger.info(`Generated: page-load.spec.ts`);
    
    // Collect all buttons (shell + MFEs)
    const allButtons: InteractiveElement[] = [...interactionMap.shell];
    for (const mfeElements of Object.values(interactionMap.mfes)) {
      allButtons.push(...mfeElements);
    }
    
    // Generate button click tests
    const buttonClickTest = generateButtonClickTest(snapshot.url, allButtons);
    if (buttonClickTest) {
      const buttonClickTestPath = join(testsDir, 'button-clicks.spec.ts');
      await writeFile(buttonClickTestPath, buttonClickTest, 'utf-8');
      Logger.info(`Generated: button-clicks.spec.ts`);
    } else {
      Logger.warn('No buttons found to generate tests for');
    }
    
    Logger.success('Test generation completed successfully');
    
  } catch (error) {
    Logger.error('Test generation failed:', error);
    throw error;
  }
}
