import { JSDOM } from 'jsdom';
import { Logger } from '../utils/logger.js';
import { saveJsonFile } from '../utils/file-system.js';
import { join } from 'path';
import { readFile } from 'fs/promises';

interface PageSnapshot {
  title: string;
  url: string;
  dom: string;
  scriptUrls: string[];
}

interface MfeAnalysis {
  shell: string;
  mfes: Array<{
    name: string;
    scripts: string[];
  }>;
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
 * Get the ARIA role of an element
 */
function getRole(element: Element): string {
  // Check explicit role attribute
  const explicitRole = element.getAttribute('role');
  if (explicitRole) {
    return explicitRole;
  }
  
  // Infer role from tag name
  const tagName = element.tagName.toLowerCase();
  
  switch (tagName) {
    case 'button':
      return 'button';
    case 'a':
      return 'link';
    case 'input':
      const inputType = (element as HTMLInputElement).type || 'text';
      if (inputType === 'button' || inputType === 'submit' || inputType === 'reset') {
        return 'button';
      }
      if (inputType === 'checkbox') {
        return 'checkbox';
      }
      if (inputType === 'radio') {
        return 'radio';
      }
      return 'textbox';
    case 'select':
      return 'combobox';
    case 'textarea':
      return 'textbox';
    default:
      // Check for interactive attributes
      if (element.hasAttribute('onclick') || element.hasAttribute('tabindex')) {
        return 'button'; // Generic interactive element
      }
      return 'generic';
  }
}

/**
 * Get accessible name for an element
 * Priority: aria-label > aria-labelledby > text content > placeholder > title > value
 */
function getAccessibleName(element: Element): string {
  // Check aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) {
    return ariaLabel.trim();
  }
  
  // Check aria-labelledby (would need to resolve, but for simplicity, skip for now)
  
  // Get text content
  const textContent = element.textContent?.trim();
  if (textContent && textContent.length > 0) {
    // For links and buttons, use text content
    if (element.tagName.toLowerCase() === 'a' || 
        element.tagName.toLowerCase() === 'button') {
      return textContent;
    }
  }
  
  // Check placeholder (for inputs)
  if (element.tagName.toLowerCase() === 'input' || 
      element.tagName.toLowerCase() === 'textarea') {
    const placeholder = element.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) {
      return placeholder.trim();
    }
  }
  
  // Check title attribute
  const title = element.getAttribute('title');
  if (title && title.trim()) {
    return title.trim();
  }
  
  // Check value (for inputs)
  if (element.tagName.toLowerCase() === 'input') {
    const value = (element as HTMLInputElement).value;
    if (value && value.trim()) {
      return value.trim();
    }
  }
  
  // Check alt text for images in buttons/links
  const img = element.querySelector('img');
  if (img) {
    const alt = img.getAttribute('alt');
    if (alt && alt.trim()) {
      return alt.trim();
    }
  }
  
  // Fallback: use tag name
  return element.tagName.toLowerCase();
}

/**
 * Generate role-first selector for an element
 */
function generateSelector(element: Element, role: string): string {
  // Role-first approach: prioritize role, then accessible name
  
  // Try to find unique attributes first
  const id = element.getAttribute('id');
  if (id) {
    return `[role="${role}"]#${id}`;
  }
  
  const name = element.getAttribute('name');
  if (name && (element.tagName.toLowerCase() === 'input' || 
               element.tagName.toLowerCase() === 'select')) {
    return `[role="${role}"][name="${name}"]`;
  }
  
  // Use aria-label if available (most reliable for role-based selection)
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) {
    const escapedLabel = ariaLabel.replace(/"/g, '\\"');
    return `[role="${role}"][aria-label="${escapedLabel}"]`;
  }
  
  // Use text content for buttons and links (via XPath-like approach in selector)
  // For standard CSS, we'll use a combination approach
  const accessibleName = getAccessibleName(element);
  if (accessibleName && accessibleName.length < 50 && 
      (element.tagName.toLowerCase() === 'button' || 
       element.tagName.toLowerCase() === 'a')) {
    // Use a combination: role + tag with text matching
    const tagName = element.tagName.toLowerCase();
    return `${tagName}[role="${role}"]`; // Text matching would need XPath or Playwright selectors
  }
  
  // Fallback: use tag and role
  const tagName = element.tagName.toLowerCase();
  return `${tagName}[role="${role}"]`;
}

/**
 * Infer MFE ownership for an element
 * Heuristics:
 * - Check for data attributes
 * - Check container patterns
 * - Default to shell
 */
function inferMfeOwner(
  element: Element,
  mfeAnalysis: MfeAnalysis,
  dom: Document
): string | undefined {
  // Check for data-mfe or similar attributes
  const dataMfe = element.getAttribute('data-mfe') || 
                  element.getAttribute('data-microfrontend') ||
                  element.getAttribute('data-remote');
  if (dataMfe) {
    // Try to match with known MFE names
    const matchingMfe = mfeAnalysis.mfes.find(mfe => 
      mfe.name.toLowerCase().includes(dataMfe.toLowerCase()) ||
      dataMfe.toLowerCase().includes(mfe.name.toLowerCase())
    );
    if (matchingMfe) {
      return matchingMfe.name;
    }
  }
  
  // Check parent containers for MFE indicators
  let current: Element | null = element.parentElement;
  while (current && current !== dom.body) {
    const containerId = current.getAttribute('id');
    const containerClass = current.getAttribute('class');
    
    // Check if container ID/class suggests MFE
    if (containerId || containerClass) {
      const containerText = `${containerId || ''} ${containerClass || ''}`.toLowerCase();
      
      for (const mfe of mfeAnalysis.mfes) {
        const mfeNameLower = mfe.name.toLowerCase();
        if (containerText.includes(mfeNameLower) || 
            containerText.includes('mfe') ||
            containerText.includes('remote') ||
            containerText.includes('microfrontend')) {
          return mfe.name;
        }
      }
    }
    
    current = current.parentElement;
  }
  
  // Default: belongs to shell
  return undefined; // undefined means shell
}

/**
 * Extract interactive elements from DOM
 */
function extractInteractiveElements(
  dom: Document,
  mfeAnalysis: MfeAnalysis
): InteractiveElement[] {
  const elements: InteractiveElement[] = [];
  const processedElements = new Set<Element>();
  
  // Extract buttons
  const buttons = dom.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]');
  buttons.forEach((button) => {
    if (processedElements.has(button)) return;
    processedElements.add(button);
    
    const role = getRole(button);
    if (role === 'button') {
      const accessibleName = getAccessibleName(button);
      const selector = generateSelector(button, role);
      const mfeOwner = inferMfeOwner(button, mfeAnalysis, dom);
      
      elements.push({
        role,
        accessibleName,
        selector,
        tagName: button.tagName.toLowerCase(),
        mfeOwner,
      });
    }
  });
  
  // Extract links
  const links = dom.querySelectorAll('a[href], [role="link"]');
  links.forEach((link) => {
    if (processedElements.has(link)) return;
    processedElements.add(link);
    
    const role = getRole(link);
    if (role === 'link') {
      const accessibleName = getAccessibleName(link);
      const selector = generateSelector(link, role);
      const mfeOwner = inferMfeOwner(link, mfeAnalysis, dom);
      
      elements.push({
        role,
        accessibleName,
        selector,
        tagName: link.tagName.toLowerCase(),
        mfeOwner,
      });
    }
  });
  
  // Extract inputs (text, email, password, etc.)
  const inputs = dom.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select, [role="textbox"], [role="combobox"], [role="checkbox"], [role="radio"]');
  inputs.forEach((input) => {
    if (processedElements.has(input)) return;
    processedElements.add(input);
    
    const role = getRole(input);
    if (['textbox', 'combobox', 'checkbox', 'radio'].includes(role)) {
      const accessibleName = getAccessibleName(input);
      const selector = generateSelector(input, role);
      const mfeOwner = inferMfeOwner(input, mfeAnalysis, dom);
      
      elements.push({
        role,
        accessibleName,
        selector,
        tagName: input.tagName.toLowerCase(),
        mfeOwner,
      });
    }
  });
  
  return elements;
}

/**
 * Map interactions and group by MFE ownership
 */
export function mapInteractions(snapshot: PageSnapshot, mfeAnalysis: MfeAnalysis): InteractionMap {
  Logger.info('Mapping interactive elements...');
  
  // Parse DOM
  const dom = new JSDOM(snapshot.dom);
  const document = dom.window.document;
  
  // Extract interactive elements
  const elements = extractInteractiveElements(document, mfeAnalysis);
  
  Logger.info(`Found ${elements.length} interactive elements`);
  
  // Group by MFE ownership
  const shell: InteractiveElement[] = [];
  const mfes: Record<string, InteractiveElement[]> = {};
  
  // Initialize MFE arrays
  for (const mfe of mfeAnalysis.mfes) {
    mfes[mfe.name] = [];
  }
  
  // Group elements
  for (const element of elements) {
    if (element.mfeOwner && mfes[element.mfeOwner]) {
      mfes[element.mfeOwner].push(element);
    } else {
      shell.push(element);
    }
  }
  
  Logger.info(`Shell: ${shell.length} elements`);
  for (const [mfeName, mfeElements] of Object.entries(mfes)) {
    Logger.info(`${mfeName}: ${mfeElements.length} elements`);
  }
  
  return {
    shell,
    mfes,
  };
}

/**
 * Analyze page snapshot and MFE analysis to create interaction map
 */
export async function analyzeInteractions(
  snapshotPath?: string,
  mfeAnalysisPath?: string
): Promise<void> {
  try {
    // Read page snapshot
    const snapshotFilePath = snapshotPath || join(process.cwd(), 'outputs', 'page-snapshot.json');
    Logger.info(`Reading page snapshot from: ${snapshotFilePath}`);
    
    const snapshotContent = await readFile(snapshotFilePath, 'utf-8');
    const snapshot: PageSnapshot = JSON.parse(snapshotContent);
    
    // Read MFE analysis
    const mfeAnalysisFilePath = mfeAnalysisPath || join(process.cwd(), 'outputs', 'mfe-analysis.json');
    Logger.info(`Reading MFE analysis from: ${mfeAnalysisFilePath}`);
    
    const mfeAnalysisContent = await readFile(mfeAnalysisFilePath, 'utf-8');
    const mfeAnalysis: MfeAnalysis = JSON.parse(mfeAnalysisContent);
    
    // Map interactions
    const interactionMap = mapInteractions(snapshot, mfeAnalysis);
    
    // Save interaction map
    const outputPath = join(process.cwd(), 'outputs', 'interaction-map.json');
    Logger.info(`Saving interaction map to: ${outputPath}`);
    await saveJsonFile(outputPath, interactionMap);
    
    Logger.success('Interaction mapping completed successfully');
    
  } catch (error) {
    Logger.error('Interaction mapping failed:', error);
    throw error;
  }
}
